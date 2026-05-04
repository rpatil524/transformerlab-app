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
  isBest: boolean;
}

const BEST_COLOR = '#22c55e';
const BEST_BORDER = '#15803d';
const POINT_COLOR = '#3b82f6';

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
    const sorted = jobs
      .map((job) => {
        const score = extractScore(job);
        const date = extractDate(job);
        if (score === null || date === null) return null;
        return {
          x: date,
          y: score,
          jobId: String(job?.id ?? ''),
          isBest: false,
        };
      })
      .filter((p): p is ChartPoint => p !== null)
      .sort((a, b) => a.x.getTime() - b.x.getTime());

    let runningMax = -Infinity;
    for (const p of sorted) {
      if (p.y > runningMax) {
        p.isBest = true;
        runningMax = p.y;
      }
    }
    return sorted;
  }, [jobs]);

  const chartData = useMemo(() => {
    const allData = points.map((p) => ({
      x: p.x,
      y: p.y,
      jobId: p.jobId,
      isBest: p.isBest,
    }));
    const bestData = points
      .filter((p) => p.isBest)
      .map((p) => ({ x: p.x, y: p.y, jobId: p.jobId, isBest: true }));
    return [
      { id: 'jobs', data: allData },
      { id: 'best', data: bestData },
    ];
  }, [points]);

  // Custom layer: stepped line connecting the running-max points.
  const BestStepLine = ({ series, xScale, yScale }: any) => {
    const best = series.find((s: any) => s.id === 'best');
    if (!best || best.data.length < 2) return null;
    const pts = best.data.map((d: any) => ({
      x: xScale(d.data.x),
      y: yScale(d.data.y),
    }));
    let path = `M ${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      path += ` L ${pts[i].x},${pts[i - 1].y} L ${pts[i].x},${pts[i].y}`;
    }
    return (
      <path
        d={path}
        stroke={BEST_COLOR}
        strokeWidth={2}
        fill="none"
        strokeLinejoin="miter"
      />
    );
  };

  // Custom layer: render points ourselves so we can size/color
  // best-so-far points differently from regular points.
  const CustomPoints = ({ series, xScale, yScale }: any) => (
    <g>
      {series.flatMap((s: any) =>
        s.id === 'jobs'
          ? s.data.map((d: any, i: number) => {
              const isBest = !!d.data.isBest;
              return (
                <circle
                  key={`pt-${i}`}
                  cx={xScale(d.data.x)}
                  cy={yScale(d.data.y)}
                  r={isBest ? 7 : 4}
                  fill={isBest ? BEST_COLOR : POINT_COLOR}
                  stroke={isBest ? BEST_BORDER : 'none'}
                  strokeWidth={isBest ? 1.5 : 0}
                />
              );
            })
          : [],
      )}
    </g>
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
            : `Score over time across ${points.length} job${points.length === 1 ? '' : 's'} — green marks the best score so far`}
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
                format: '%b %d %H:%M',
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
              colors={[POINT_COLOR, BEST_COLOR]}
              lineWidth={0}
              enablePoints={false}
              layers={[
                'grid',
                'axes',
                BestStepLine,
                CustomPoints,
                'mesh',
                'crosshair',
              ]}
              useMesh
              tooltip={({ point }) => {
                const jobId = (point.data as any).jobId as string;
                const shortId = jobId ? jobId.slice(0, 8) : '';
                const isBest = !!(point.data as any).isBest;
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
                      {isBest && (
                        <span style={{ color: BEST_BORDER, marginLeft: 6 }}>
                          best so far
                        </span>
                      )}
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
