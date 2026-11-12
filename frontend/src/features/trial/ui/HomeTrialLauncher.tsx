import PlayArrowOutlinedIcon from "@mui/icons-material/PlayArrowOutlined";
import ThumbUpOutlinedIcon from "@mui/icons-material/ThumbUpOutlined";
import {
  Alert,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Grid,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useCreateTrialEvent,
  useCreateTrialFeedback,
  useTrialHome
} from "@/features/trial/state/useTrialWorkspace";
import { WorkspacePageTemplate } from "@/modules/workspace/WorkspacePageTemplate";

export function HomeTrialLauncher() {
  const navigate = useNavigate();
  const homeQuery = useTrialHome();
  const eventMutation = useCreateTrialEvent();
  const feedbackMutation = useCreateTrialFeedback();
  const [notes, setNotes] = useState("");

  return (
    <WorkspacePageTemplate
      workspace="Home"
      pageTitle="Trial Launcher"
      description="Guided trial entry with scenario paths, prototype limitations, and immediate feedback capture."
      status="Increment 7"
    >
      <Stack spacing={3}>
        {homeQuery.error instanceof Error ? <Alert severity="error">{homeQuery.error.message}</Alert> : null}

        <Grid container spacing={2}>
          {(homeQuery.data?.scenarios ?? []).map((scenario) => (
            <Grid key={scenario.scenario_code} size={{ xs: 12, md: 4 }}>
              <Card variant="outlined">
                <CardContent>
                  <Stack spacing={1}>
                    <Typography variant="h6">{scenario.title}</Typography>
                    <Chip label={scenario.persona} size="small" sx={{ alignSelf: "flex-start" }} />
                    <Typography variant="body2" color="text.secondary">
                      {scenario.summary}
                    </Typography>
                  </Stack>
                </CardContent>
                <CardActions>
                  <Button
                    startIcon={<PlayArrowOutlinedIcon />}
                    onClick={() => {
                      eventMutation.mutate({
                        event_type: "scenario.started",
                        scenario_code: scenario.scenario_code,
                        user_label: "guided-user",
                        metadata: { entry: "home" }
                      });
                      navigate(scenario.route);
                    }}
                  >
                    Start
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Known limitations
            </Typography>
            <List dense>
              {(homeQuery.data?.known_limitations ?? []).map((item) => (
                <ListItem key={item} disablePadding>
                  <ListItemText primary={item} />
                </ListItem>
              ))}
            </List>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6">Quick feedback</Typography>
              <TextField
                label="What would help most in the next trial conversation?"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                multiline
                minRows={3}
              />
              <Button
                variant="contained"
                startIcon={<ThumbUpOutlinedIcon />}
                onClick={() =>
                  feedbackMutation.mutate({
                    scenario_code: "home_launcher",
                    usefulness_score: 4,
                    trust_score: 4,
                    ease_score: 4,
                    next_step: "submit_feedback",
                    notes
                  })
                }
              >
                Submit feedback
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </WorkspacePageTemplate>
  );
}
