export type TaskRowLike = {
  name: string;
};

export function jobBelongsToTask(job: any, task: TaskRowLike): boolean {
  const jd = job?.job_data ?? {};
  const name = task.name?.trim() ?? '';
  if (!name) return false;
  if (jd.task_name && jd.task_name === name) return true;
  if (jd.template_name && jd.template_name === name) return true;
  return false;
}
