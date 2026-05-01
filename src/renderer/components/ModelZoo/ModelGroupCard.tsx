import { Box, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/joy';
import { PackageIcon, PencilIcon, Trash2Icon } from 'lucide-react';

export interface GroupSummary {
  group_id: string;
  group_name: string;
  asset_type: string;
  description: string;
  version_count: number;
  latest_version_label: string | null;
  latest_tag: string | null;
  latest_created_at: string | null;
}

const TAG_COLORS: Record<
  string,
  'success' | 'primary' | 'warning' | 'neutral'
> = {
  latest: 'primary',
  production: 'success',
  draft: 'warning',
};

interface ModelGroupCardProps {
  group: GroupSummary;
  onOpen: (groupId: string) => void;
  onEdit: (group: GroupSummary) => void;
  onDelete: (group: GroupSummary) => void;
}

export default function ModelGroupCard({
  group,
  onOpen,
  onEdit,
  onDelete,
}: ModelGroupCardProps) {
  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit(group);
  };
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(group);
  };

  return (
    <Box
      onClick={() => onOpen(group.group_id)}
      sx={{
        position: 'relative',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 'md',
        p: 1.5,
        cursor: 'pointer',
        transition: 'background 0.15s ease, border-color 0.15s ease',
        '&:hover': {
          borderColor: 'primary.outlinedBorder',
          background: 'background.level1',
        },
        '&:hover .ModelGroupCard-actions': { opacity: 1 },
      }}
    >
      <Stack direction="row" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
        <PackageIcon size={16} style={{ flexShrink: 0 }} />
        <Typography
          level="title-sm"
          fontWeight="lg"
          noWrap
          sx={{ flex: 1, minWidth: 0 }}
        >
          {group.group_name}
        </Typography>
        <Chip size="sm" variant="soft" color="neutral">
          {group.version_count} version{group.version_count !== 1 ? 's' : ''}
        </Chip>
        {group.latest_tag && (
          <Chip
            size="sm"
            variant="soft"
            color={TAG_COLORS[group.latest_tag] || 'neutral'}
          >
            {group.latest_tag}
          </Chip>
        )}
      </Stack>

      {group.description && (
        <Tooltip title={group.description} placement="top">
          <Typography level="body-xs" color="neutral" noWrap sx={{ mt: 0.5 }}>
            {group.description}
          </Typography>
        </Tooltip>
      )}

      <Stack
        direction="row"
        gap={0.5}
        className="ModelGroupCard-actions"
        sx={{
          position: 'absolute',
          top: 6,
          right: 6,
          opacity: 0,
          transition: 'opacity 0.15s ease',
          background: 'background.surface',
          borderRadius: 'sm',
        }}
      >
        <IconButton
          size="sm"
          variant="plain"
          color="neutral"
          onClick={handleEdit}
          aria-label="Edit model group"
        >
          <PencilIcon size={14} />
        </IconButton>
        <IconButton
          size="sm"
          variant="plain"
          color="danger"
          onClick={handleDelete}
          aria-label="Delete model group"
        >
          <Trash2Icon size={14} />
        </IconButton>
      </Stack>
    </Box>
  );
}
