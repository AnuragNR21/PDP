import { AddOutlined, ArrowDownwardOutlined, ArrowUpwardOutlined, SearchOutlined } from "@mui/icons-material";
import { Box, Button, Card, CardContent, Chip, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { ReparentNodeDialog, type ReparentNodeInfo } from "../dialogs/ReparentNodeDialog";
import { SimpleTreeView, TreeItem } from "@mui/x-tree-view";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BadgeCustomization, HierarchyNodeTreeItem, InstanceParentAssignment } from "../../domain/types";
import { displayLabel } from "../../domain/utils";
import { BadgeIcon } from "../shared/BadgeIcon";
import { OverflowText } from "@/shared/workspace/OverflowText";

function NodeAvatar({ badge, name }: { badge: BadgeCustomization; name: string }) {
  const text = badge.badgeText.trim() || name.trim().charAt(0).toUpperCase();
  return (
    <BadgeIcon
      badgeText={text}
      badgeShape={badge.badgeShape}
      badgeColor={badge.badgeColor}
      badgeTextColor={badge.badgeTextColor}
      badgeIcon={badge.badgeIcon ?? undefined}
      badgeSize={badge.badgeSize}
      badgeContentType={badge.badgeContentType}
    />
  );
}

function nodeMatchesSearch(item: HierarchyNodeTreeItem, query: string): boolean {
  if (item.name.toLowerCase().includes(query) || displayLabel(item).toLowerCase().includes(query)) return true;
  return item.children.some((child) => nodeMatchesSearch(child, query));
}

function filterTree(items: HierarchyNodeTreeItem[], query: string): HierarchyNodeTreeItem[] {
  if (!query) return items;
  return items
    .filter((item) => nodeMatchesSearch(item, query))
    .map((item) => ({ ...item, children: filterTree(item.children, query) }));
}

function RenderNode({
  item,
  siblingIndex,
  siblingCount,
  selectedNodeId,
  dropTargetId,
  draggedId,
  onSelectNode,
  onAddChild,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onContextMenuNode,
}: {
  item: HierarchyNodeTreeItem;
  siblingIndex: number;
  siblingCount: number;
  selectedNodeId: string | null;
  dropTargetId: string | null;
  draggedId: string | null;
  onSelectNode: (id: string) => void;
  onAddChild: (id: string) => void;
  onMoveUp: (id: string, parentNodeId: string | null, position: number) => void;
  onMoveDown: (id: string, parentNodeId: string | null, position: number) => void;
  onDragStart: (id: string, parentNodeId: string | null, name: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, targetId: string) => void;
  onContextMenuNode?: (id: string, name: string, event: React.MouseEvent) => void;
}) {
  const isDropTarget = dropTargetId === item.id && draggedId !== item.id;
  const label = displayLabel(item);

  return (
    <TreeItem
      itemId={String(item.id)}
      label={
        <Stack
          direction="row"
          spacing={0.5}
          alignItems="center"
          sx={{
            py: 0.25,
            borderRadius: 1,
            outline: isDropTarget ? '2px dashed #1976d2' : 'none',
            outlineOffset: -2,
            bgcolor: isDropTarget ? 'primary.50' : 'transparent',
            transition: 'outline 0.1s, background-color 0.1s',
          }}
          draggable
          onDragStart={(e) => { e.stopPropagation(); onDragStart(item.id, item.parentNodeId ?? null, label); }}
          onDragOver={(e) => { e.stopPropagation(); onDragOver(e, item.id); }}
          onDragLeave={(e) => { e.stopPropagation(); onDragLeave(); }}
          onDrop={(e) => { e.stopPropagation(); onDrop(e, item.id); }}
          onContextMenu={onContextMenuNode ? (e) => onContextMenuNode(item.id, label, e) : undefined}
          data-reveal-id={item.id}
        >
          <NodeAvatar badge={item.badge} name={label} />
          <OverflowText
            variant="body2"
            sx={{ fontWeight: item.id === selectedNodeId ? 700 : 400, flex: 1, minWidth: 0, cursor: 'default' }}
          >
            {label}
          </OverflowText>

          {/* Sibling reorder buttons — only shown when search is not active */}
          <Tooltip title={siblingIndex === 0 ? "First in this level" : "Move up"}>
            <span onClick={(e) => e.stopPropagation()}>
              <IconButton
                size="small"
                disabled={siblingIndex === 0}
                onClick={(e) => { e.stopPropagation(); onMoveUp(item.id, item.parentNodeId ?? null, siblingIndex - 1); }}
                sx={{ p: 0.25 }}
              >
                <ArrowUpwardOutlined sx={{ fontSize: 14 }} />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={siblingIndex >= siblingCount - 1 ? "Last in this level" : "Move down"}>
            <span onClick={(e) => e.stopPropagation()}>
              <IconButton
                size="small"
                disabled={siblingIndex >= siblingCount - 1}
                onClick={(e) => { e.stopPropagation(); onMoveDown(item.id, item.parentNodeId ?? null, siblingIndex + 1); }}
                sx={{ p: 0.25 }}
              >
                <ArrowDownwardOutlined sx={{ fontSize: 14 }} />
              </IconButton>
            </span>
          </Tooltip>

          {/* A property node holds a value, not a level, so there is nothing
              to add beneath it. The button is removed rather than disabled:
              a greyed one invites clicking at it and explains nothing. The
              chip beside the name is what says why. */}
          {item.isProperty ? (
            <Tooltip title="A property node holds a value rather than a level of the hierarchy, so nothing can be placed beneath it.">
              <Chip
                size="small"
                variant="outlined"
                label="property"
                sx={{ height: 18, fontSize: "0.62rem" }}
              />
            </Tooltip>
          ) : (
            <Tooltip title={`Add a child node type under ${label}`}>
              <Button
                size="small"
                startIcon={<AddOutlined sx={{ fontSize: '14px !important' }} />}
                sx={{ fontSize: 11, px: 0.75, minWidth: 0, flexShrink: 0, '& .MuiButton-startIcon': { mr: 0.25 } }}
                onClick={(event) => {
                  event.stopPropagation();
                  onAddChild(item.id);
                }}
              >
                Child
              </Button>
            </Tooltip>
          )}
        </Stack>
      }
      onClick={(e) => { e.stopPropagation(); onSelectNode(item.id); }}
    >
      {item.children.map((child, childIndex) => (
        <RenderNode
          key={child.id}
          item={child}
          siblingIndex={childIndex}
          siblingCount={item.children.length}
          selectedNodeId={selectedNodeId}
          dropTargetId={dropTargetId}
          draggedId={draggedId}
          onSelectNode={onSelectNode}
          onAddChild={onAddChild}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onContextMenuNode={onContextMenuNode}
        />
      ))}
    </TreeItem>
  );
}

export function NodeTypeTreePanel(props: {
  items: HierarchyNodeTreeItem[];
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  onAddRoot?: () => void;
  onAddChild: (id: string) => void;
  onReorderNode?: (nodeId: string, newParentNodeId: string | null, position: number, confirmInstanceReparent?: boolean, instanceParentAssignments?: InstanceParentAssignment[]) => void;
  /** Right-click on a node type. */
  onContextMenuNode?: (id: string, name: string, event: React.MouseEvent) => void;
  /** Bring this node type into view: open its ancestors and scroll to it. A new object each time. */
  revealRequest?: { id: string } | null;
}) {
  const { items, selectedNodeId, onSelectNode, onAddChild, onReorderNode } = props;
  const [search, setSearch] = useState("");
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  // Drag-and-drop state
  const draggedRef = useRef<{ id: string; parentNodeId: string | null; name: string } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // Pending depth-change confirmation
  const [pendingReparent, setPendingReparent] = useState<ReparentNodeInfo | null>(null);

  const filtered = useMemo(() => filterTree(items, search.toLowerCase().trim()), [items, search]);

  // Collect all node IDs from items (unfiltered) to auto-expand new nodes
  const allItemIds = useMemo(() => {
    const ids: string[] = [];
    const collect = (nodes: typeof items) => nodes.forEach((n) => { ids.push(String(n.id)); collect(n.children); });
    collect(items);
    return ids;
  }, [items]);

  // Track IDs we have already seen (ever). Only genuinely new nodes get auto-expanded.
  // Using a ref so that reorders (same IDs, new array reference) don't cause re-expansion
  // of nodes the user has manually collapsed.
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const newIds = allItemIds.filter((id) => !seenIdsRef.current.has(id));
    if (newIds.length > 0) {
      newIds.forEach((id) => seenIdsRef.current.add(id));
      setExpandedItems((prev) => [...prev, ...newIds]);
    }
  }, [allItemIds]);

  // Find in Model: open every ancestor (and clear a search that would hide it), then scroll to it.
  useEffect(() => {
    const id = props.revealRequest?.id;
    if (!id) return;
    const path: string[] = [];
    const walk = (nodes: HierarchyNodeTreeItem[], trail: string[]): boolean => {
      for (const node of nodes) {
        if (node.id === id) {
          path.push(...trail);
          return true;
        }
        if (walk(node.children, [...trail, String(node.id)])) return true;
      }
      return false;
    };
    if (!walk(items, [])) return;
    setSearch("");
    setExpandedItems((previous) => Array.from(new Set([...previous, ...path])));
    const timer = window.setTimeout(() => {
      document.querySelector(`[data-reveal-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [props.revealRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragStart = (id: string, parentNodeId: string | null, name: string) => {
    draggedRef.current = { id, parentNodeId, name };
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (id !== draggedRef.current?.id) {
      setDropTargetId(id);
    }
  };

  const handleDragLeave = () => {
    setDropTargetId(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const source = draggedRef.current;
    draggedRef.current = null;
    setDropTargetId(null);
    if (!source || source.id === targetId || !onReorderNode) return;
    const findNode = (nodes: HierarchyNodeTreeItem[], id: string): HierarchyNodeTreeItem | null => {
      for (const n of nodes) {
        if (n.id === id) return n;
        const found = findNode(n.children, id);
        if (found) return found;
      }
      return null;
    };
    const targetNode = findNode(items, targetId);
    const position = targetNode ? targetNode.children.length : 0;
    // Depth changes when the new parent differs from the current parent
    if (targetId !== source.parentNodeId) {
      const oldParentNode = source.parentNodeId ? findNode(items, source.parentNodeId) : null;
      setPendingReparent({
        nodeId: source.id,
        nodeName: source.name,
        oldParentName: oldParentNode ? displayLabel(oldParentNode) : 'Root Level',
        newParentNodeId: targetId,
        newParentName: targetNode ? displayLabel(targetNode) : targetId,
        position,
      });
    } else {
      onReorderNode(source.id, targetId, position);
    }
  };

  const handleMoveUp = (nodeId: string, parentNodeId: string | null, position: number) => {
    onReorderNode?.(nodeId, parentNodeId, position);
  };

  const handleMoveDown = (nodeId: string, parentNodeId: string | null, position: number) => {
    onReorderNode?.(nodeId, parentNodeId, position);
  };

  return (
  <>
    <Card variant="outlined" sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <Stack spacing={2} sx={{ height: '100%' }}>
          <Typography variant="h6">Node Type Hierarchy</Typography>

          <TextField
            size="small"
            placeholder="Search node types..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <SearchOutlined fontSize="small" color="action" />
                </InputAdornment>
              ),
            }}
          />

          <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {filtered.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {search ? "No matching node types." : "No hierarchy nodes yet."}
              </Typography>
            ) : (
              <SimpleTreeView expansionTrigger="iconContainer" expandedItems={expandedItems} onExpandedItemsChange={(_e, ids) => setExpandedItems(ids)}>
                {filtered.map((item, index) => (
                  <RenderNode
                    key={item.id}
                    item={item}
                    siblingIndex={index}
                    siblingCount={filtered.length}
                    selectedNodeId={selectedNodeId}
                    dropTargetId={dropTargetId}
                    draggedId={draggedRef.current?.id ?? null}
                    onSelectNode={onSelectNode}
                    onAddChild={onAddChild}
                    onMoveUp={handleMoveUp}
                    onMoveDown={handleMoveDown}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onContextMenuNode={props.onContextMenuNode}
                  />
                ))}
              </SimpleTreeView>
            )}
          </Box>
        </Stack>
      </CardContent>
    </Card>

    <ReparentNodeDialog
      pending={pendingReparent}
      onConfirm={(info, assignments) => { onReorderNode?.(info.nodeId, info.newParentNodeId, info.position, true, assignments); setPendingReparent(null); }}
      onCancel={() => setPendingReparent(null)}
    />
  </>
  );
}
