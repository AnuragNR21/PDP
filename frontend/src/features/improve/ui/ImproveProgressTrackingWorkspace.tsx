import {
  Alert,
  Card,
  CardContent,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from "@mui/material";
import { WorkspacePageTemplate } from "@/modules/workspace/WorkspacePageTemplate";
import { useImproveTasks, useUpdateTaskStatus } from "@/features/improve/state/useImproveWorkspace";

const TASK_STATUSES = ["open", "in_progress", "blocked", "done", "verified"] as const;

export function ImproveProgressTrackingWorkspace() {
  const tasksQuery = useImproveTasks();
  const updateTaskStatus = useUpdateTaskStatus();

  return (
    <WorkspacePageTemplate
      workspace="Improve"
      pageTitle="Progress Tracking"
      description="Track remediation tasks, change lifecycle states, and keep candidate closure driven by evidence-backed completion."
      status="Increment 6"
    >
      <Stack spacing={3}>
        {tasksQuery.error instanceof Error ? <Alert severity="error">{tasksQuery.error.message}</Alert> : null}

        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Remediation tasks
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Program</TableCell>
                  <TableCell>Title</TableCell>
                  <TableCell>Assignee</TableCell>
                  <TableCell>Due</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(tasksQuery.data ?? []).map((task) => (
                  <TableRow key={task.task_id} hover>
                    <TableCell>{task.program_id}</TableCell>
                    <TableCell>
                      <Typography fontWeight={600}>{task.title}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {task.detail}
                      </Typography>
                      {task.source_title ? <Chip size="small" sx={{ mt: 1 }} label={task.source_title} /> : null}
                    </TableCell>
                    <TableCell>{task.assignee_name}{task.assignee_party_id ? ` · ${task.assignee_party_id}` : ""}</TableCell>
                    <TableCell>{task.due_date ?? "—"}</TableCell>
                    <TableCell width={180}>
                      <FormControl fullWidth size="small">
                        <InputLabel id={`task-status-${task.task_id}`}>Status</InputLabel>
                        <Select
                          labelId={`task-status-${task.task_id}`}
                          label="Status"
                          value={task.status}
                          onChange={(event) =>
                            updateTaskStatus.mutate({ taskId: task.task_id, status: event.target.value })
                          }
                        >
                          {TASK_STATUSES.map((status) => (
                            <MenuItem key={status} value={status}>
                              {status}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Stack>
    </WorkspacePageTemplate>
  );
}
