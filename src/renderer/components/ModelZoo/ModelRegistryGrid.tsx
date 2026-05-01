import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  DialogTitle,
  FormControl,
  FormLabel,
  IconButton,
  Input,
  Modal,
  ModalClose,
  ModalDialog,
  Option,
  Select,
  Sheet,
  Skeleton,
  Stack,
  Textarea,
  Typography,
} from '@mui/joy';
import { PackageIcon, RotateCcwIcon, SearchIcon } from 'lucide-react';
import {
  useSWRWithAuth as useSWR,
  fetchWithAuth,
} from 'renderer/lib/authContext';
import * as chatAPI from '../../lib/transformerlab-api-sdk';
import { fetcher } from '../../lib/transformerlab-api-sdk';
import { licenseTypes, modelTypes } from '../../lib/utils';
import ModelGroupCard, { GroupSummary } from './ModelGroupCard';

function GridSkeleton() {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 1.5,
      }}
    >
      {[...Array(8)].map((_, i) => (
        <Skeleton
          key={i}
          variant="rectangular"
          sx={{ height: 64, borderRadius: 'md' }}
        />
      ))}
    </Box>
  );
}

function EditGroupModal({
  open,
  onClose,
  group,
  mutateGroups,
}: {
  open: boolean;
  onClose: () => void;
  group: GroupSummary;
  mutateGroups: () => void;
}) {
  const [name, setName] = useState(group.group_name);
  const [description, setDescription] = useState(group.description || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetchWithAuth(
        chatAPI.Endpoints.AssetVersions.UpdateGroup('model', group.group_id),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description }),
        },
      );
      await mutateGroups();
      onClose();
    } catch (err) {
      console.error('Failed to update group:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog sx={{ width: 480 }}>
        <ModalClose />
        <DialogTitle>Edit Model Group</DialogTitle>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <FormControl>
            <FormLabel>Name</FormLabel>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </FormControl>
          <FormControl>
            <FormLabel>Description</FormLabel>
            <Textarea
              minRows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this model group…"
            />
          </FormControl>
          <Button loading={saving} onClick={handleSave}>
            Save
          </Button>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}

export default function ModelRegistryGrid() {
  const navigate = useNavigate();
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [editingGroup, setEditingGroup] = useState<GroupSummary | null>(null);

  const {
    data: groups,
    isLoading,
    isError,
    mutate: mutateGroups,
  } = useSWR(chatAPI.Endpoints.AssetVersions.ListGroups('model'), fetcher);

  const handleDeleteGroup = async (group: GroupSummary) => {
    if (
      !window.confirm(
        `Delete group "${group.group_name}" and ALL its versions? The underlying models will not be deleted.`,
      )
    ) {
      return;
    }
    try {
      await fetchWithAuth(
        chatAPI.Endpoints.AssetVersions.DeleteGroup('model', group.group_id),
        { method: 'DELETE' },
      );
      mutateGroups();
    } catch (err) {
      console.error('Failed to delete group:', err);
    }
  };

  const groupList: GroupSummary[] = Array.isArray(groups) ? groups : [];
  const filteredGroups = groupList.filter((g) => {
    const search = searchText.toLowerCase();
    if (search && !g.group_name.toLowerCase().includes(search)) return false;
    return true;
  });

  return (
    <Sheet
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      {/* Top bar — single aligned row, no &nbsp; label hack */}
      <Stack
        direction="row"
        alignItems="flex-end"
        gap={1.5}
        sx={{ pb: 2, flexWrap: 'wrap' }}
      >
        <FormControl size="sm" sx={{ flex: 1, minWidth: 200 }}>
          <FormLabel>Search</FormLabel>
          <Input
            placeholder="Search by name"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            startDecorator={<SearchIcon />}
          />
        </FormControl>

        <FormControl size="sm" sx={{ minWidth: 160 }}>
          <FormLabel>License</FormLabel>
          <Select
            placeholder="Filter by license"
            slotProps={{ button: { sx: { whiteSpace: 'nowrap' } } }}
            value={filters?.license}
            disabled
            onChange={(_e, newValue) =>
              setFilters({ ...filters, license: newValue as string })
            }
          >
            {licenseTypes.map((type) => (
              <Option value={type} key={type}>
                {type}
              </Option>
            ))}
          </Select>
        </FormControl>

        <FormControl size="sm" sx={{ minWidth: 160 }}>
          <FormLabel>Architecture</FormLabel>
          <Select
            placeholder="All"
            disabled
            value={filters?.architecture}
            onChange={(_e, newValue) =>
              setFilters({ ...filters, architecture: newValue as string })
            }
          >
            {modelTypes.map((type) => (
              <Option value={type} key={type}>
                {type}
              </Option>
            ))}
          </Select>
        </FormControl>

        <IconButton
          variant="outlined"
          color="neutral"
          size="sm"
          onClick={() => mutateGroups()}
          aria-label="Refresh models"
          sx={{ height: 32 }}
        >
          <RotateCcwIcon size={16} />
          &nbsp; Refresh
        </IconButton>
      </Stack>

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {isLoading ? (
          <GridSkeleton />
        ) : isError ? (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography color="danger">
              Failed to load model registry groups.
            </Typography>
          </Box>
        ) : filteredGroups.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <PackageIcon size={48} color="gray" style={{ marginBottom: 16 }} />
            <Typography level="body-lg" color="neutral">
              {searchText
                ? 'No model groups match your search.'
                : 'No model groups yet.'}
            </Typography>
            {!searchText && (
              <Typography level="body-sm" color="neutral" sx={{ mt: 1 }}>
                Publish a model from a completed Job to create your first model.
              </Typography>
            )}
          </Box>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 1.5,
            }}
          >
            {filteredGroups.map((group) => (
              <ModelGroupCard
                key={group.group_id}
                group={group}
                onOpen={(id) => navigate(`/zoo/registry/${id}`)}
                onEdit={(g) => setEditingGroup(g)}
                onDelete={handleDeleteGroup}
              />
            ))}
          </Box>
        )}
      </Box>

      {editingGroup && (
        <EditGroupModal
          open
          onClose={() => setEditingGroup(null)}
          group={editingGroup}
          mutateGroups={mutateGroups}
        />
      )}
    </Sheet>
  );
}
