import React, { useState, useMemo } from 'react';
import {
  Table,
  ButtonGroup,
  Typography,
  IconButton,
  Button,
  Dropdown,
  MenuButton,
  Menu,
  MenuItem,
  Skeleton,
  Chip,
  Box,
} from '@mui/joy';
import {
  PlayIcon,
  Trash2Icon,
  MoreVerticalIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ArrowUpIcon,
  ArrowDownIcon,
} from 'lucide-react';
import SafeJSONParse from 'renderer/components/Shared/SafeJSONParse';

type TaskRow = {
  id: string;
  title?: string;
  name: string;
  description?: string;
  type?: string;
  datasets?: any;
  config: string | object;
  created?: string;
  updated?: string;
  remote_task?: boolean;
};

function jobBelongsToTask(job: any, task: TaskRow): boolean {
  const jd = job?.job_data ?? {};
  const name = task.name?.trim() ?? '';
  if (name && jd.task_name && jd.task_name === name) return true;
  if (name && jd.template_name && jd.template_name === name) return true;
  return false;
}

type TaskTemplateListProps = {
  tasksList: TaskRow[];
  onDeleteTask?: (taskId: string, taskName?: string) => void;
  onQueueTask: (task: TaskRow) => void;
  onEditTask: (task: TaskRow) => void;
  onExportTask?: (taskId: string) => void;
  onViewFilesTask?: (task: TaskRow) => void;
  loading: boolean;
  interactTasks?: boolean;
  allJobs?: any[];
  allJobsLoading?: boolean;
  expandedTaskIds?: Set<string>;
  onToggleTaskExpanded?: (taskId: string) => void;
  renderJobsForTask?: (taskId: string, jobs: any[]) => React.ReactNode;
};

function relativeTime(ts: string | undefined): string {
  if (!ts) return '—';
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 0) return 'just now';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function getTitle(task: TaskRow) {
  if (task.title && task.title.trim() !== '') {
    return task.title;
  }
  return task.name;
}

const TaskTemplateList: React.FC<TaskTemplateListProps> = ({
  tasksList,
  onDeleteTask,
  onQueueTask,
  onEditTask,
  onExportTask,
  onViewFilesTask,
  loading,
  interactTasks = false,
  allJobs = [],
  allJobsLoading = false,
  expandedTaskIds = new Set(),
  onToggleTaskExpanded,
  renderJobsForTask,
}) => {
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const lastRunByTaskName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const job of allJobs) {
      if (job?.placeholder) continue;
      const jd = job?.job_data ?? {};
      const taskName = (jd.task_name || jd.template_name || '').trim();
      if (!taskName) continue;
      const ts: string = job.created_at || job.created || '';
      if (!ts) continue;
      if (!map[taskName] || ts > map[taskName]) {
        map[taskName] = ts;
      }
    }
    return map;
  }, [allJobs]);

  const sortedTasks = useMemo(() => {
    return [...tasksList].sort((a, b) => {
      const tsA = lastRunByTaskName[a.name?.trim() ?? ''] ?? '';
      const tsB = lastRunByTaskName[b.name?.trim() ?? ''] ?? '';
      if (!tsA && !tsB) return 0;
      if (!tsA) return 1;
      if (!tsB) return -1;
      return sortDir === 'desc'
        ? tsB.localeCompare(tsA)
        : tsA.localeCompare(tsB);
    });
  }, [tasksList, sortDir, lastRunByTaskName]);

  const getResourcesInfo = (task: TaskRow) => {
    if (task.type !== 'REMOTE') {
      return 'N/A';
    }

    // For templates, fields are stored directly (not nested in config)
    // Check if it's a template (no config or config is empty/just an object)
    const config =
      (typeof task.config === 'string'
        ? SafeJSONParse(task.config as string, {})
        : (task.config as any)) || {};

    // Check if config has nested structure (old task format) or is empty
    const isTemplate =
      !task.config ||
      (typeof config === 'object' && Object.keys(config).length === 0) ||
      (!config.run && !config.cluster_name);

    // Use template fields directly if it's a template, otherwise use config
    const cpus = isTemplate ? (task as any).cpus : config.cpus;
    const memory = isTemplate ? (task as any).memory : config.memory;
    const disk_space = isTemplate
      ? (task as any).disk_space
      : config.disk_space;
    const accelerators = isTemplate
      ? (task as any).accelerators
      : config.accelerators;
    const num_nodes = isTemplate ? (task as any).num_nodes : config.num_nodes;

    const resources: string[] = [];
    if (cpus) resources.push(`CPUs: ${cpus}`);
    if (memory) resources.push(`Memory: ${memory}`);
    if (disk_space) resources.push(`Disk: ${disk_space}`);
    if (accelerators) resources.push(`Accelerators: ${accelerators}`);
    if (num_nodes) resources.push(`Nodes: ${num_nodes}`);

    return resources.length > 0
      ? resources.join(', ')
      : 'No resources specified';
  };

  const getCommandInfo = (task: TaskRow) => {
    if (task.type !== 'REMOTE') {
      return 'N/A';
    }

    // For templates, fields are stored directly (not nested in config)
    const config =
      (typeof task.config === 'string'
        ? SafeJSONParse(task.config as string, {})
        : (task.config as any)) || {};

    // Check if config has nested structure (old task format) or is empty
    const isTemplate =
      !task.config ||
      (typeof config === 'object' && Object.keys(config).length === 0) ||
      (!config.run && !config.cluster_name);

    // Use template field directly if it's a template, otherwise use config
    const run = isTemplate
      ? (task as any).run || 'No run command specified'
      : config.run || 'No run command specified';

    // Truncate long commands
    return run.length > 50 ? `${run.substring(0, 50)}...` : run;
  };

  const getProviderInfo = (task: TaskRow) => {
    if (task.type !== 'REMOTE') {
      return 'N/A';
    }

    // For templates, fields are stored directly (not nested in config)
    const config =
      (typeof task.config === 'string'
        ? SafeJSONParse(task.config as string, {})
        : (task.config as any)) || {};

    // Check if config has nested structure (old task format) or is empty
    const isTemplate =
      !task.config ||
      (typeof config === 'object' && Object.keys(config).length === 0) ||
      (!config.run && !config.cluster_name);

    // Use template field directly if it's a template, otherwise use config
    const providerName = isTemplate
      ? (task as any).provider_name
      : config.provider_name;

    return providerName || 'Not specified';
  };

  if (loading) {
    return (
      <Table stickyHeader sx={{ tableLayout: 'fixed', width: '100%' }}>
        <thead>
          <tr>
            <th style={{ width: '20%' }}>Name</th>
            {interactTasks && <th style={{ width: '10%' }}>Provider</th>}
            <th style={{ width: '6%', textAlign: 'center' }}>Runs</th>
            <th style={{ width: '14%' }}>Last Run</th>
            <th style={{ width: '22%' }}>Command</th>
            <th style={{ width: '14%' }}>Resources</th>
            <th style={{ width: '24%', textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {[1, 2, 3, 4].map((i) => (
            <tr key={i}>
              <td>
                <Skeleton variant="text" level="title-sm" />
              </td>
              {interactTasks && (
                <td>
                  <Skeleton variant="text" level="title-sm" />
                </td>
              )}
              <td>
                <Skeleton variant="text" level="body-sm" />
              </td>
              <td>
                <Skeleton variant="text" level="body-sm" />
              </td>
              <td>
                <Skeleton variant="text" level="body-sm" />
              </td>
              <td>
                <Skeleton variant="text" level="body-sm" />
              </td>
              <td style={{ textAlign: 'right' }}>
                <Skeleton
                  variant="rectangular"
                  width={200}
                  height={32}
                  sx={{ ml: 'auto' }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    );
  }

  return (
    <Table
      stickyHeader
      hoverRow
      sx={{
        tableLayout: 'fixed',
        width: '100%',
        // Thicker top border when one collapsed task immediately follows another
        '& tbody tr[data-task-row] + tr[data-task-row] > td': {
          borderTopWidth: '2px',
        },
      }}
    >
      <thead>
        <tr>
          <th style={{ width: '20%' }}>Name</th>
          {interactTasks && <th style={{ width: '10%' }}>Provider</th>}
          <th style={{ width: '6%', textAlign: 'center' }}>Runs</th>
          <th
            style={{ width: '14%', cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              Last Run
              {sortDir === 'desc' ? (
                <ArrowDownIcon size={12} />
              ) : (
                <ArrowUpIcon size={12} />
              )}
            </Box>
          </th>
          <th style={{ width: '22%' }}>Command</th>
          <th style={{ width: '14%' }}>Resources</th>
          <th style={{ width: '24%', textAlign: 'right' }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {sortedTasks.map((row) => {
          const isExpanded = expandedTaskIds.has(row.id);
          const taskJobs = allJobs.filter((job) => jobBelongsToTask(job, row));
          return (
            <React.Fragment key={row.id}>
              <tr data-task-row="">
                <td>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {onToggleTaskExpanded && (
                      <IconButton
                        size="sm"
                        variant="plain"
                        color="neutral"
                        onClick={() => onToggleTaskExpanded(row.id)}
                        sx={{ minWidth: 0, p: 0.25 }}
                      >
                        {isExpanded ? (
                          <ChevronDownIcon size={14} />
                        ) : (
                          <ChevronRightIcon size={14} />
                        )}
                      </IconButton>
                    )}
                    <Typography level="title-sm" sx={{ overflow: 'clip' }}>
                      {getTitle(row)}
                    </Typography>
                  </Box>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <Typography level="body-sm" sx={{ color: 'text.secondary' }}>
                    {allJobsLoading ? (
                      <Skeleton
                        variant="text"
                        level="body-sm"
                        width={16}
                        sx={{ display: 'inline-block' }}
                      />
                    ) : taskJobs.length > 0 ? (
                      taskJobs.length
                    ) : (
                      '—'
                    )}
                  </Typography>
                </td>
                <td>
                  <Typography level="body-sm" sx={{ color: 'text.secondary' }}>
                    {allJobsLoading ? (
                      <Skeleton
                        variant="text"
                        level="body-sm"
                        width={40}
                        sx={{ display: 'inline-block' }}
                      />
                    ) : (
                      relativeTime(lastRunByTaskName[row.name?.trim() ?? ''])
                    )}
                  </Typography>
                </td>
                {interactTasks && (
                  <td style={{ overflow: 'clip' }}>
                    <Typography level="body-sm">{row.provider_name}</Typography>
                  </td>
                )}
                <td style={{ overflow: 'clip' }}>
                  <Typography level="body-sm">{getCommandInfo(row)}</Typography>
                </td>
                <td style={{ overflow: 'hidden' }}>
                  <Typography level="body-sm">
                    {getResourcesInfo(row)}
                  </Typography>
                </td>
                <td
                  style={{
                    overflow: 'visible',
                  }}
                >
                  <ButtonGroup sx={{ justifyContent: 'flex-end' }}>
                    <Button
                      startDecorator={<PlayIcon />}
                      variant="soft"
                      color="success"
                      onClick={() => onQueueTask?.(row)}
                    >
                      Queue
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={() => onEditTask?.(row)}
                    >
                      Edit
                    </Button>
                    <IconButton
                      variant="plain"
                      color="danger"
                      onClick={() => onDeleteTask?.(row.id, getTitle(row))}
                      title="Delete task"
                    >
                      <Trash2Icon style={{ cursor: 'pointer' }} />
                    </IconButton>
                    {(onExportTask || onViewFilesTask) && (
                      <Dropdown>
                        <MenuButton
                          slots={{ root: IconButton }}
                          slotProps={{
                            root: { variant: 'plain', color: 'neutral' },
                          }}
                          sx={{ minWidth: 0 }}
                        >
                          <MoreVerticalIcon size={16} />
                        </MenuButton>
                        <Menu>
                          {onViewFilesTask && (
                            <MenuItem onClick={() => onViewFilesTask?.(row)}>
                              View Files
                            </MenuItem>
                          )}
                          {onExportTask && (
                            <MenuItem onClick={() => onExportTask?.(row.id)}>
                              Export to Team Gallery
                            </MenuItem>
                          )}
                        </Menu>
                      </Dropdown>
                    )}
                  </ButtonGroup>
                </td>
              </tr>
              {isExpanded && renderJobsForTask && (
                <tr>
                  <td
                    colSpan={99}
                    style={{ padding: 0, border: 'none', width: '100%' }}
                  >
                    <Box
                      sx={{
                        display: 'block',
                        width: '100%',
                        pl: 4,
                        pr: 1,
                        py: 1,
                        bgcolor: 'background.level1',
                        borderBottom: '2px solid',
                        borderColor: 'neutral.300',
                        '& table': {
                          tableLayout: 'auto',
                          width: '100%',
                        },
                      }}
                    >
                      {taskJobs.length === 0 ? (
                        <Typography
                          level="body-sm"
                          sx={{ color: 'text.tertiary', py: 1 }}
                        >
                          No runs yet
                        </Typography>
                      ) : (
                        renderJobsForTask(row.id, taskJobs)
                      )}
                    </Box>
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </Table>
  );
};

export default TaskTemplateList;
