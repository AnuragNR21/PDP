import { PropsWithChildren } from "react";
import { ThemeProvider, createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#0B5FFF"
    },
    secondary: {
      main: "#3A7A57"
    },
    background: {
      default: "#F6F8FB",
      paper: "#FFFFFF"
    }
  },
  shape: {
    borderRadius: 10
  },
  typography: {
    h4: {
      fontWeight: 700
    },
    h5: {
      fontWeight: 700
    },
    h6: {
      fontWeight: 600
    }
  }
});

export function AppThemeProvider({ children }: PropsWithChildren) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
