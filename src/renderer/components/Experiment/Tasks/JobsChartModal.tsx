import { useMemo } from 'react';
import { Box, Modal, ModalClose, ModalDialog, Typography } from '@mui/joy';
import { ResponsiveLine } from '@nivo/line';

interface JobsChartModalProps {
  open: boolean;
  onClose: () => void;
  jobs: any[];
}

interface ChartPoint {
  x: Date;
  y: number;
  jobId: string;
}

function extractScore(job: any): number | null {
  const raw = job?.job_data?.score;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (raw && typeof raw === 'object') {
    for (const value of Object.values(raw)) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
  }
  return null;
}

function extractDate(job: any): Date | null {
  const raw =
    job?.created_at ??
    job?.job_data?.start_time ??
    job?.job_data?.end_time ??
    null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function JobsChartModal({
  open,
  onClose,
  jobs,
}: JobsChartModalProps) {
  const points = useMemo<ChartPoint[]>(() => {
    if (!Array.isArray(jobs)) return [];
    return jobs
      .map((job) => {
        const score = extractScore(job);
        const date = extractDate(job);
        if (score === null || date === null) return null;
        return { x: date, y: score, jobId: String(job?.id ?? '') };
      })
      .filter((p): p is ChartPoint => p !== null)
      .sort((a, b) => a.x.getTime() - b.x.getTime());
  }, [jobs]);

  const chartData = useMemo(
    () => [
      {
        id: 'jobs',
        data: points.map((p) => ({ x: p.x, y: p.y, jobId: p.jobId })),
      },
    ],
    [points],
  );

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog sx={{ width: '90vw', maxWidth: '1200px', height: '85vh' }}>
        <ModalClose />
        <Typography level="title-lg" sx={{ mb: 1 }}>
          Jobs Chart
        </Typography>
        <Typography level="body-sm" sx={{ mb: 2, color: 'text.tertiary' }}>
          {points.length === 0
            ? 'No jobs with a score and date to plot'
            : `Score over time across ${points.length} job${points.length === 1 ? '' : 's'}`}
        </Typography>
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            border: '1px solid',
            borderColor: 'neutral.outlinedBorder',
            borderRadius: 'sm',
          }}
        >
          {points.length > 0 ? (
            <ResponsiveLine
              data={chartData}
              margin={{ top: 24, right: 32, bottom: 64, left: 64 }}
              xScale={{ type: 'time', precision: 'minute' }}
              xFormat="time:%Y-%m-%d %H:%M"
              yScale={{
                type: 'linear',
                min: 'auto',
                max: 'auto',
                stacked: false,
              }}
              axisBottom={{
                format: '%b %d',
                tickRotation: -30,
                legend: 'Date',
                legendOffset: 50,
                legendPosition: 'middle',
              }}
              axisLeft={{
                legend: 'Score',
                legendOffset: -48,
                legendPosition: 'middle',
              }}
              enableGridX={false}
              enableGridY
              colors={{ scheme: 'category10' }}
              lineWidth={0}
              pointSize={10}
              pointBorderWidth={1}
              pointBorderColor={{ from: 'serieColor' }}
              useMesh
              tooltip={({ point }) => {
                const jobId = (point.data as any).jobId as string;
                const shortId = jobId ? jobId.slice(0, 8) : '';
                return (
                  <Box
                    sx={{
                      bgcolor: 'background.surface',
                      border: '1px solid',
                      borderColor: 'neutral.outlinedBorder',
                      borderRadius: 'sm',
                      p: 1,
                      fontSize: 12,
                    }}
                  >
                    <div>
                      <b>{shortId}</b>
                    </div>
                    <div>Score: {String(point.data.yFormatted)}</div>
                    <div>{String(point.data.xFormatted)}</div>
                  </Box>
                );
              }}
            />
          ) : (
            <Box
              sx={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography level="body-sm" sx={{ color: 'text.tertiary' }}>
                No jobs with both a score and a date to plot
              </Typography>
            </Box>
          )}
        </Box>
      </ModalDialog>
    </Modal>
  );
}
