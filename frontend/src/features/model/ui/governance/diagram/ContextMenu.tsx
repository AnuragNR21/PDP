import CheckIcon from "@mui/icons-material/Check";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { Box, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Popper, Tooltip, Typography } from "@mui/material";
import { useRef, useState, type ReactNode } from "react";

export type MenuEntry =
  | { kind: "item"; key: string; label: string; icon?: ReactNode; onClick: () => void; checked?: boolean; disabled?: boolean; danger?: boolean; keepOpen?: boolean }
  | { kind: "sub"; key: string; label: string; icon?: ReactNode; items: MenuEntry[]; disabled?: boolean }
  | { kind: "swatches"; key: string; options: ReadonlyArray<{ value: string; label: string }>; current?: string | null; onPick: (value: string) => void }
  | { kind: "header"; key: string; label: string }
  | { kind: "divider"; key: string };

function Entries({ items, onClose, depth }: { items: MenuEntry[]; onClose: () => void; depth: number }) {
  const [openSub, setOpenSub] = useState<string | null>(null);
  const anchors = useRef(new Map<string, HTMLElement>());
  return (
    <>
      {items.map((entry) => {
        if (entry.kind === "divider") return <Divider key={entry.key} sx={{ my: 0.5 }} />;
        if (entry.kind === "header") {
          return (
            <Typography key={entry.key} sx={{ px: 2, pt: 0.75, pb: 0.25, fontSize: 10.5, fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.4 }}>
              {entry.label}
            </Typography>
          );
        }
        if (entry.kind === "swatches") {
          return (
            <Box key={entry.key} sx={{ display: "grid", gridTemplateColumns: "repeat(4, 26px)", gap: 0.75, px: 1.5, py: 1 }}>
              {entry.options.map((option) => (
                <Tooltip key={option.value} title={option.label}>
                  <Box
                    role="button"
                    aria-label={option.label}
                    onClick={() => {
                      entry.onPick(option.value);
                      onClose();
                    }}
                    sx={{
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      bgcolor: option.value,
                      cursor: "pointer",
                      border: "2px solid",
                      borderColor: entry.current === option.value ? "text.primary" : "transparent",
                      boxShadow: "inset 0 0 0 2px #fff",
                    }}
                  />
                </Tooltip>
              ))}
            </Box>
          );
        }
        if (entry.kind === "sub") {
          const open = openSub === entry.key;
          return (
            <MenuItem
              key={entry.key}
              dense
              disabled={entry.disabled}
              ref={(el: HTMLLIElement | null) => {
                if (el) anchors.current.set(entry.key, el);
              }}
              onMouseEnter={() => setOpenSub(entry.key)}
              onClick={() => setOpenSub(open ? null : entry.key)}
              selected={open}
              sx={{ minHeight: 32 }}
            >
              {entry.icon && <ListItemIcon sx={{ "& svg": { fontSize: 18 } }}>{entry.icon}</ListItemIcon>}
              <ListItemText primaryTypographyProps={{ fontSize: 13 }}>{entry.label}</ListItemText>
              <ChevronRightIcon sx={{ fontSize: 18, color: "text.secondary", ml: 1 }} />
              <Popper
                open={open}
                anchorEl={anchors.current.get(entry.key) ?? null}
                placement="right-start"
                disablePortal
                sx={{ zIndex: 1 + depth }}
                modifiers={[{ name: "offset", options: { offset: [-6, 4] } }]}
              >
                <Paper elevation={8} sx={{ py: 0.5, minWidth: 180 }} onClick={(event) => event.stopPropagation()}>
                  <Entries items={entry.items} onClose={onClose} depth={depth + 1} />
                </Paper>
              </Popper>
            </MenuItem>
          );
        }
        return (
          <MenuItem
            key={entry.key}
            dense
            disabled={entry.disabled}
            onMouseEnter={() => setOpenSub(null)}
            onClick={() => {
              entry.onClick();
              if (!entry.keepOpen) onClose();
            }}
            sx={{ minHeight: 32, color: entry.danger ? "error.main" : undefined }}
          >
            {entry.icon && <ListItemIcon sx={{ "& svg": { fontSize: 18 }, color: entry.danger ? "error.main" : undefined }}>{entry.icon}</ListItemIcon>}
            <ListItemText primaryTypographyProps={{ fontSize: 13 }}>{entry.label}</ListItemText>
            {entry.checked && <CheckIcon sx={{ fontSize: 16, color: "primary.main", ml: 1 }} />}
          </MenuItem>
        );
      })}
    </>
  );
}

/**
 * A right-click menu at a point, with fly-out submenus. Used for the node,
 * relationship and canvas menus of the diagram.
 */
export function ContextMenu(props: { position: { top: number; left: number } | null; title?: string; items: MenuEntry[]; onClose: () => void }) {
  return (
    <Menu
      open={Boolean(props.position)}
      onClose={props.onClose}
      anchorReference="anchorPosition"
      anchorPosition={props.position ?? undefined}
      onContextMenu={(event) => event.preventDefault()}
      slotProps={{ paper: { sx: { minWidth: 230, overflow: "visible" } } }}
      MenuListProps={{ dense: true, sx: { py: 0.5 } }}
    >
      {props.title && (
        <Typography sx={{ px: 2, pt: 0.5, pb: 0.75, fontSize: 12, fontWeight: 700, color: "text.secondary", maxWidth: 280 }} noWrap>
          {props.title}
        </Typography>
      )}
      {props.title && <Divider sx={{ mb: 0.5 }} />}
      <Entries items={props.items} onClose={props.onClose} depth={0} />
    </Menu>
  );
}
