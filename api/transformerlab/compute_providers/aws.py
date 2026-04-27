"""AWS EC2 compute provider implementation."""

from __future__ import annotations

import asyncio
import io
from typing import Any, Dict, List, Optional, Union

from .base import ComputeProvider
from .models import (
    ClusterConfig,
    ClusterState,
    ClusterStatus,
    JobConfig,
    JobInfo,
    ResourceInfo,
)


# ---------------------------------------------------------------------------
# Instance selection tables
# ---------------------------------------------------------------------------

_GPU_INSTANCE_MAP: Dict[tuple, str] = {
    ("T4", 1): "g4dn.xlarge",
    ("T4", 4): "g4dn.12xlarge",
    ("T4", 8): "g4dn.metal",
    ("A10G", 1): "g5.xlarge",
    ("A10G", 4): "g5.12xlarge",
    ("A10G", 8): "g5.48xlarge",
    ("L4", 1): "g6.xlarge",
    ("L4", 4): "g6.12xlarge",
    ("L4", 8): "g6.48xlarge",
    ("L40S", 1): "g6e.xlarge",
    ("L40S", 4): "g6e.12xlarge",
    ("L40S", 8): "g6e.48xlarge",
    ("V100", 1): "p3.2xlarge",
    ("V100", 4): "p3.8xlarge",
    ("V100", 8): "p3.16xlarge",
    ("V100-32GB", 8): "p3dn.24xlarge",
    ("A100", 8): "p4d.24xlarge",
    ("A100-80GB", 8): "p4de.24xlarge",
    ("H100", 8): "p5.48xlarge",
    ("H200", 8): "p5e.48xlarge",
    ("RadeonV520", 1): "g4ad.xlarge",
    ("RadeonV520", 2): "g4ad.8xlarge",
    ("RadeonV520", 4): "g4ad.16xlarge",
}

_CPU_INSTANCE_OPTIONS: List[tuple] = sorted(
    [
        (2, 4, "c5.large"),
        (2, 8, "m5.large"),
        (2, 16, "r5.large"),
        (4, 8, "c5.xlarge"),
        (4, 16, "m5.xlarge"),
        (4, 32, "r5.xlarge"),
        (8, 16, "c5.2xlarge"),
        (8, 32, "m5.2xlarge"),
        (8, 64, "r5.2xlarge"),
        (16, 32, "c5.4xlarge"),
        (16, 64, "m5.4xlarge"),
        (16, 128, "r5.4xlarge"),
        (32, 128, "m5.8xlarge"),
        (32, 256, "r5.8xlarge"),
        (36, 72, "c5.9xlarge"),
        (48, 96, "c5.12xlarge"),
        (48, 192, "m5.12xlarge"),
        (48, 384, "r5.12xlarge"),
        (64, 256, "m5.16xlarge"),
        (64, 512, "r5.16xlarge"),
        (72, 144, "c5.18xlarge"),
        (96, 192, "c5.24xlarge"),
        (96, 384, "m5.24xlarge"),
        (96, 768, "r5.24xlarge"),
    ],
    key=lambda x: (x[0], x[1]),
)


def _resolve_gpu_instance_type(accelerators: str) -> str:
    """Map an accelerator spec (e.g. 'A100:8') to an EC2 instance type.

    Raises ValueError for unrecognized types or unsupported counts.
    """
    parts = accelerators.strip().split(":")
    accel_type = parts[0].strip()
    count = int(parts[1].strip()) if len(parts) > 1 else 1
    key = (accel_type, count)
    if key not in _GPU_INSTANCE_MAP:
        valid = sorted(f"{t}:{c}" for t, c in _GPU_INSTANCE_MAP)
        raise ValueError(f"Unsupported accelerator spec '{accelerators}'. Valid options: {', '.join(valid)}")
    return _GPU_INSTANCE_MAP[key]


def _parse_memory_gb(memory: Union[int, float, str, None]) -> float:
    """Parse memory field (int GB, float GB, '16GB' string, or None) to float GB."""
    if memory is None:
        return 0.0
    if isinstance(memory, (int, float)):
        return float(memory)
    stripped = str(memory).strip().upper()
    for suffix in ("GB", "G", "MB", "M"):
        if stripped.endswith(suffix):
            stripped = stripped[: -len(suffix)].strip()
            break
    try:
        return float(stripped)
    except ValueError:
        return 0.0


def _resolve_cpu_instance_type(
    cpus: Union[int, str, None],
    memory: Union[int, float, str, None],
) -> str:
    """Select smallest EC2 CPU instance satisfying both vCPU and memory constraints.

    Raises ValueError if the combination exceeds available options.
    """
    requested_cpus = int(cpus) if cpus else 0
    requested_memory = _parse_memory_gb(memory)
    for vcpus, mem_gb, instance_type in _CPU_INSTANCE_OPTIONS:
        if vcpus >= requested_cpus and mem_gb >= requested_memory:
            return instance_type
    raise ValueError(
        f"No EC2 CPU instance found for cpus={requested_cpus}, memory={requested_memory}GB. "
        f"Maximum available: 96 vCPUs, 768 GB memory."
    )


# ---------------------------------------------------------------------------
# EC2 state mapping
# ---------------------------------------------------------------------------

_EC2_STATE_TO_CLUSTER_STATE: Dict[str, ClusterState] = {
    "pending": ClusterState.INIT,
    "running": ClusterState.UP,
    "stopping": ClusterState.STOPPED,
    "stopped": ClusterState.STOPPED,
    "shutting-down": ClusterState.DOWN,
    "terminated": ClusterState.DOWN,
}


def _ssh_read_file(host: str, key_bytes: bytes, remote_path: str, tail_lines: int = 500) -> str:
    """SSH to host and read a file. Returns string content or error message."""
    import paramiko

    pkey = None
    key_file = io.StringIO(key_bytes.decode("utf-8"))
    for key_class in (paramiko.Ed25519Key, paramiko.RSAKey):
        try:
            pkey = key_class.from_private_key(key_file)
            break
        except Exception:
            key_file.seek(0)

    if pkey is None:
        return "Failed to load SSH key."

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(hostname=host, port=22, username="ubuntu", pkey=pkey, timeout=15, banner_timeout=15)
        cmd = f"tail -n {tail_lines} {remote_path} 2>/dev/null || echo 'No log file yet.'"
        _, stdout, _ = ssh.exec_command(cmd, timeout=10)
        return stdout.read().decode("utf-8", errors="replace").strip() or "No output yet."
    except Exception as e:
        return f"SSH failed: {e}"
    finally:
        ssh.close()


class AWSProvider(ComputeProvider):
    """Compute provider that launches ephemeral EC2 instances per job."""

    def __init__(
        self,
        aws_profile: str,
        region: str,
        team_id: str,
        extra_config: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.aws_profile = aws_profile
        self.region = region
        self.team_id = team_id
        self.extra_config = extra_config or {}

    def _get_boto3_session(self):
        import boto3

        return boto3.Session(profile_name=self.aws_profile, region_name=self.region)

    def _get_ec2_client(self):
        return self._get_boto3_session().client("ec2")

    def _get_sts_client(self):
        return self._get_boto3_session().client("sts")

    def check(self) -> bool:
        try:
            self._get_sts_client().get_caller_identity()
            return True
        except Exception as e:
            print(f"AWS provider check failed: {e}")
            return False

    def _ensure_security_group(self, ec2) -> str:
        sg_name = f"transformerlab-compute-{self.team_id}"
        response = ec2.describe_security_groups(Filters=[{"Name": "group-name", "Values": [sg_name]}])
        groups = response.get("SecurityGroups", [])
        if groups:
            return groups[0]["GroupId"]

        sg_response = ec2.create_security_group(
            GroupName=sg_name,
            Description=f"TransformerLab compute provider for team {self.team_id}",
        )
        sg_id = sg_response["GroupId"]
        ec2.authorize_security_group_ingress(
            GroupId=sg_id,
            IpPermissions=[
                {
                    "IpProtocol": "tcp",
                    "FromPort": 22,
                    "ToPort": 22,
                    "IpRanges": [{"CidrIp": "0.0.0.0/0"}],
                }
            ],
        )
        return sg_id

    def _ensure_key_pair(self, ec2, public_key_bytes: bytes) -> str:
        from botocore.exceptions import ClientError

        key_name = f"transformerlab-{self.team_id}"
        try:
            ec2.describe_key_pairs(KeyNames=[key_name])
            return key_name
        except ClientError as e:
            if e.response["Error"]["Code"] != "InvalidKeyPair.NotFound":
                raise
        ec2.import_key_pair(KeyName=key_name, PublicKeyMaterial=public_key_bytes)
        return key_name

    def _get_latest_dl_ami(self, ec2) -> str:
        # AWS occasionally changes DLAMI naming. Try multiple known patterns.
        name_patterns = [
            "Deep Learning AMI GPU PyTorch*Ubuntu*",
            "Deep Learning Base OSS Nvidia Driver GPU AMI*Ubuntu*",
            "Deep Learning OSS Nvidia Driver AMI GPU*Ubuntu*",
        ]
        owners = ["amazon", "898082745236"]

        for name_pattern in name_patterns:
            response = ec2.describe_images(
                Owners=owners,
                Filters=[
                    {"Name": "name", "Values": [name_pattern]},
                    {"Name": "state", "Values": ["available"]},
                    {"Name": "architecture", "Values": ["x86_64"]},
                ],
            )
            images = sorted(response.get("Images", []), key=lambda x: x.get("CreationDate", ""), reverse=True)
            if images:
                return images[0]["ImageId"]

        raise RuntimeError(f"No Deep Learning AMI found in region {self.region}")

    def _resolve_instance_type(self, config: ClusterConfig) -> str:
        if config.accelerators:
            return _resolve_gpu_instance_type(config.accelerators)
        return _resolve_cpu_instance_type(config.cpus, config.memory)

    @staticmethod
    def _build_user_data(config: ClusterConfig) -> str:
        env_exports = "\n".join(f'export {k}="{v}"' for k, v in config.env_vars.items())
        setup_block = config.setup or ""
        run_cmd = config.run or ""
        return f"""#!/bin/bash
set -eo pipefail
mkdir -p /workspace
# Ubuntu 24+ marks system Python as externally managed (PEP 668).
# Allow bootstrap pip installs used by remote setup commands.
export PIP_BREAK_SYSTEM_PACKAGES=1
# Install uv for task setups that use `uv pip ...`.
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
{env_exports}
{setup_block}
({run_cmd}) 2>&1 | tee /workspace/run_logs.txt
"""

    # --- Cluster management methods ---

    def _find_instance_by_cluster_name(self, ec2, cluster_name: str) -> Optional[Dict[str, Any]]:
        response = ec2.describe_instances(
            Filters=[
                {"Name": "tag:transformerlab-cluster-name", "Values": [cluster_name]},
                {"Name": "tag:transformerlab-team-id", "Values": [self.team_id]},
                {"Name": "instance-state-name", "Values": ["pending", "running", "stopping", "stopped"]},
            ]
        )
        for reservation in response.get("Reservations", []):
            instances = reservation.get("Instances", [])
            if instances:
                return instances[0]
        return None

    def launch_cluster(self, cluster_name: str, config: ClusterConfig) -> Dict[str, Any]:
        from transformerlab.services.ssh_key_service import (
            get_or_create_org_ssh_key_pair,
            get_org_ssh_public_key,
        )

        async def _ensure_and_get_public_key() -> str:
            await get_or_create_org_ssh_key_pair(self.team_id)
            return await get_org_ssh_public_key(self.team_id)

        ec2 = self._get_ec2_client()
        instance_type = self._resolve_instance_type(config)
        sg_id = self._ensure_security_group(ec2)
        public_key_str = asyncio.run(_ensure_and_get_public_key())
        key_name = self._ensure_key_pair(ec2, public_key_str.encode("utf-8"))
        ami_id = self._get_latest_dl_ami(ec2)
        user_data = self._build_user_data(config)

        launch_params: Dict[str, Any] = {
            "ImageId": ami_id,
            "InstanceType": instance_type,
            "MinCount": 1,
            "MaxCount": 1,
            "KeyName": key_name,
            "SecurityGroupIds": [sg_id],
            "UserData": user_data,
            "TagSpecifications": [
                {
                    "ResourceType": "instance",
                    "Tags": [
                        {"Key": "Name", "Value": cluster_name},
                        {"Key": "transformerlab-team-id", "Value": self.team_id},
                        {"Key": "transformerlab-cluster-name", "Value": cluster_name},
                    ],
                }
            ],
        }

        if config.disk_size:
            launch_params["BlockDeviceMappings"] = [
                {
                    "DeviceName": "/dev/sda1",
                    "Ebs": {"VolumeSize": config.disk_size, "VolumeType": "gp3"},
                }
            ]

        try:
            response = ec2.run_instances(**launch_params)
            instance_id = response["Instances"][0]["InstanceId"]
            return {"instance_id": instance_id, "request_id": instance_id}
        except Exception as e:
            raise RuntimeError(f"Failed to launch EC2 instance: {e}") from e

    def stop_cluster(self, cluster_name: str) -> Dict[str, Any]:
        ec2 = self._get_ec2_client()
        instance = self._find_instance_by_cluster_name(ec2, cluster_name)
        if not instance:
            return {"status": "error", "message": f"Instance '{cluster_name}' not found", "cluster_name": cluster_name}
        instance_id = instance["InstanceId"]
        try:
            ec2.terminate_instances(InstanceIds=[instance_id])
            return {"status": "success", "message": f"Instance '{cluster_name}' terminated", "instance_id": instance_id}
        except Exception as e:
            return {"status": "error", "message": str(e), "cluster_name": cluster_name, "instance_id": instance_id}

    def get_cluster_status(self, cluster_name: str) -> ClusterStatus:
        ec2 = self._get_ec2_client()
        instance = self._find_instance_by_cluster_name(ec2, cluster_name)
        if not instance:
            # Also check terminated instances
            response = ec2.describe_instances(
                Filters=[
                    {"Name": "tag:transformerlab-cluster-name", "Values": [cluster_name]},
                    {"Name": "tag:transformerlab-team-id", "Values": [self.team_id]},
                ]
            )
            for reservation in response.get("Reservations", []):
                instances = reservation.get("Instances", [])
                if instances:
                    instance = instances[0]
                    break
        if not instance:
            return ClusterStatus(cluster_name=cluster_name, state=ClusterState.UNKNOWN)

        ec2_state = instance.get("State", {}).get("Name", "unknown")
        state = _EC2_STATE_TO_CLUSTER_STATE.get(ec2_state, ClusterState.UNKNOWN)
        return ClusterStatus(
            cluster_name=cluster_name,
            state=state,
            status_message=ec2_state,
            provider_data=instance,
        )

    def get_job_logs(
        self,
        cluster_name: str,
        job_id: Union[str, int],
        tail_lines: Optional[int] = None,
        follow: bool = False,
    ) -> str:
        from transformerlab.services.ssh_key_service import get_org_ssh_private_key

        ec2 = self._get_ec2_client()
        instance = self._find_instance_by_cluster_name(ec2, cluster_name)
        if not instance:
            return f"Instance '{cluster_name}' not found or not running."

        public_ip = instance.get("PublicIpAddress")
        if not public_ip:
            return "Instance has no public IP yet (still starting)."

        key_bytes = asyncio.run(get_org_ssh_private_key(self.team_id))
        return _ssh_read_file(public_ip, key_bytes, "/workspace/run_logs.txt", tail_lines or 500)

    def list_clusters(self) -> List[ClusterStatus]:
        ec2 = self._get_ec2_client()
        response = ec2.describe_instances(
            Filters=[
                {"Name": "tag:transformerlab-team-id", "Values": [self.team_id]},
                {"Name": "instance-state-name", "Values": ["pending", "running", "stopping", "stopped"]},
            ]
        )
        statuses = []
        for reservation in response.get("Reservations", []):
            for instance in reservation.get("Instances", []):
                tags = {t["Key"]: t["Value"] for t in instance.get("Tags", [])}
                cluster_name = tags.get("transformerlab-cluster-name", instance["InstanceId"])
                ec2_state = instance.get("State", {}).get("Name", "unknown")
                state = _EC2_STATE_TO_CLUSTER_STATE.get(ec2_state, ClusterState.UNKNOWN)
                statuses.append(
                    ClusterStatus(
                        cluster_name=cluster_name,
                        state=state,
                        status_message=ec2_state,
                        provider_data=instance,
                    )
                )
        return statuses

    def get_cluster_resources(self, cluster_name: str) -> ResourceInfo:
        ec2 = self._get_ec2_client()
        instance = self._find_instance_by_cluster_name(ec2, cluster_name)
        if not instance:
            return ResourceInfo(cluster_name=cluster_name, gpus=[], num_nodes=1)
        return ResourceInfo(
            cluster_name=cluster_name,
            gpus=[],
            num_nodes=1,
            provider_data=instance,
        )

    def get_clusters_detailed(self) -> List[Dict[str, Any]]:
        clusters = self.list_clusters()
        detailed = []
        for status in clusters:
            state_str = status.state.name if hasattr(status.state, "name") else str(status.state)
            is_up = state_str.upper() in ("UP", "INIT")
            detailed.append(
                {
                    "cluster_id": status.cluster_name,
                    "cluster_name": status.cluster_name,
                    "backend_type": "AWS EC2",
                    "elastic_enabled": True,
                    "max_nodes": 1,
                    "head_node_ip": (status.provider_data or {}).get("PublicIpAddress"),
                    "nodes": [
                        {
                            "node_name": status.cluster_name,
                            "is_fixed": False,
                            "is_active": is_up,
                            "state": state_str.upper(),
                            "reason": status.status_message or state_str,
                            "resources": {
                                "cpus_total": 0,
                                "cpus_allocated": 0,
                                "gpus": {},
                                "gpus_free": {},
                                "memory_gb_total": 0,
                                "memory_gb_allocated": 0,
                            },
                        }
                    ],
                }
            )
        return detailed

    def submit_job(self, cluster_name: str, job_config: JobConfig) -> Dict[str, Any]:
        raise NotImplementedError("AWS EC2 provider uses tfl-remote-trap for job dispatch")

    def list_jobs(self, cluster_name: str) -> List[JobInfo]:
        raise NotImplementedError("AWS EC2 provider uses tfl-remote-trap for job dispatch")

    def cancel_job(self, cluster_name: str, job_id: Union[str, int]) -> Dict[str, Any]:
        raise NotImplementedError("AWS EC2 provider uses tfl-remote-trap for job dispatch")
