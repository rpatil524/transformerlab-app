import time
import pytest


@pytest.fixture
def fake_cancel_check_factory():
    # Returns a cancel_check that cancels after a few calls
    call_count = {"value": 0}

    def fake_cancel_check():
        call_count["value"] += 1
        time.sleep(0.2)  # simulate polling delay
        return call_count["value"] >= 3

    return fake_cancel_check


def test_jobs_list(client):
    resp = client.get("/experiment/1/jobs/list")
    assert resp.status_code in (200, 404)


def test_jobs_delete_all(client):
    resp = client.get("/experiment/1/jobs/delete_all")
    assert resp.status_code == 200
    data = resp.json()
    assert "message" in data or data == []
    if "message" in data:
        assert isinstance(data["message"], str)


def test_jobs_delete_all_via_delete_method(client):
    """The new RESTful DELETE /jobs/delete_all should work alongside the legacy GET."""
    resp = client.delete("/experiment/1/jobs/delete_all")
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("message") == "OK"
    # Should report a deleted count (may be 0 if experiment has no jobs)
    assert "deleted" in data
    assert isinstance(data["deleted"], int)


def test_jobs_get_by_id(client):
    resp = client.get("/experiment/1/jobs/1")
    assert resp.status_code in (200, 404)


def test_jobs_delete_by_id(client):
    resp = client.get("/experiment/1/jobs/delete/1")
    assert resp.status_code in (200, 404)


def test_jobs_delete_by_id_via_delete_method(client):
    """The new RESTful DELETE /jobs/{id} should work alongside the legacy GET."""
    resp = client.delete("/experiment/1/jobs/1")
    # 404 if no such job, 200 if it existed and was deleted, 405/422 if route doesn't exist
    assert resp.status_code in (200, 404)


def test_jobs_delete_by_id_returns_404_when_missing(client):
    """A nonexistent job id should now return 404 (not the previous silent 200)."""
    resp = client.delete("/experiment/1/jobs/nonexistent-job-id-xyz")
    assert resp.status_code == 404


def test_jobs_get_template(client):
    resp = client.get("/experiment/1/jobs/template/1")
    assert resp.status_code in (200, 404)
