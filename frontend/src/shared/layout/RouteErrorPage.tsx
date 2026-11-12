import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom';

function Panel(props: { icon: React.ReactNode; title: string; text: string; detail?: string; reload?: boolean }) {
  const navigate = useNavigate();
  return (
    <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
      <Paper variant="outlined" sx={{ p: 4, maxWidth: 560, width: '100%', textAlign: 'center' }}>
        <Stack spacing={1.5} alignItems="center">
          {props.icon}
          <Typography variant="h6" fontWeight={700}>
            {props.title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {props.text}
          </Typography>
          {props.detail && (
            <Typography
              variant="caption"
              component="pre"
              sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', bgcolor: 'grey.100', p: 1, borderRadius: 1, maxWidth: '100%', textAlign: 'left' }}
            >
              {props.detail}
            </Typography>
          )}
          <Stack direction="row" spacing={1}>
            {props.reload && (
              <Button variant="contained" onClick={() => window.location.reload()}>
                Reload page
              </Button>
            )}
            <Button variant={props.reload ? 'outlined' : 'contained'} onClick={() => navigate('/home')}>
              Go to Home
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}

/** An address that matches no page. */
export function NotFoundPage() {
  return (
    <Panel
      icon={<SearchOffOutlined sx={{ fontSize: 40, color: 'text.secondary' }} />}
      title="Page not found"
      text="There is no page at this address. It may have moved, or the link may be mistyped."
    />
  );
}

/**
 * Shown in place of a page that failed to load or render, instead of the
 * router's developer screen — the menu stays, and the page can be reloaded.
 */
export function RouteErrorPage() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : undefined;
  return (
    <Panel
      icon={<ErrorOutlineOutlined sx={{ fontSize: 40, color: 'error.main' }} />}
      title="This page ran into a problem"
      text="Something went wrong while showing this page. Reloading usually fixes it; your saved work is not affected."
      detail={detail}
      reload
    />
  );
}
