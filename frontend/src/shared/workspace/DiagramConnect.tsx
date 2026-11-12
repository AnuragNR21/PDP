import { GlobalStyles } from '@mui/material';
import { Handle, Position, useConnection } from '@xyflow/react';
import { createContext, useContext } from 'react';

/**
 * Drag-to-create relationships, the same on every PDP diagram.
 *
 * Hovering a node shows a connector dot on its right edge; dragging from it
 * draws a line. While the line is out, every node it may be dropped on is
 * ringed in blue (and one it may not, faded); a valid node takes the drop
 * anywhere on its card. The diagram's `onConnect` then opens the standard
 * Relationship Editor with source and target already filled in.
 *
 * The node's existing hidden handles stay first in the DOM, so the edges
 * already drawn keep attaching where they did.
 */
const SOURCE_HANDLE_ID = 'pdp-connect-source';
const TARGET_HANDLE_ID = 'pdp-connect-target';

/** Once per diagram: the connector only shows on hover, selection or while connecting. */
export function DiagramConnectStyles() {
  return (
    <GlobalStyles
      styles={{
        '.react-flow__node .pdp-connect-handle': { opacity: 0, transition: 'opacity 120ms' },
        '.react-flow__node:hover .pdp-connect-handle, .react-flow__node.selected .pdp-connect-handle, .react-flow__handle.connectingfrom.pdp-connect-handle':
          { opacity: 1 },
      }}
    />
  );
}

/**
 * Which drops a diagram allows, for every node on it: `(fromId, toId) => boolean`.
 * Absent, every node may be the target (the Model Workspace).
 */
export const ConnectRuleContext = createContext<((fromNodeId: string, toNodeId: string) => boolean) | null>(null);

/** Where this node stands in a drag that is in progress. */
export function useConnectTarget(nodeId: string, canTarget?: (fromNodeId: string) => boolean) {
  const rule = useContext(ConnectRuleContext);
  if (!canTarget && rule) canTarget = (fromId) => rule(fromId, nodeId);
  const fromId = useConnection((connection) => (connection.inProgress ? connection.fromNode.id : null));
  if (!fromId) return { connecting: false, isSource: false, valid: false };
  if (fromId === nodeId) return { connecting: true, isSource: true, valid: false };
  return { connecting: true, isSource: false, valid: canTarget ? canTarget(fromId) : true };
}

/** The ring on a node while a relationship is being dragged: blue if it can be the target, faded if not. */
export function connectTargetSx(state: ReturnType<typeof useConnectTarget>) {
  if (!state.connecting || state.isSource) return {};
  return state.valid
    ? { outline: '2px solid #1976d2', outlineOffset: 2, boxShadow: '0 0 0 4px rgba(25,118,210,0.15)' }
    : { opacity: 0.4 };
}

/** The connector dot (drag from here) and, while dragging, the drop area over the whole card. */
export function ConnectHandles(props: { nodeId: string; canTarget?: (fromNodeId: string) => boolean; disabled?: boolean }) {
  const state = useConnectTarget(props.nodeId, props.canTarget);
  if (props.disabled) return null;
  return (
    <>
      <Handle
        id={SOURCE_HANDLE_ID}
        type="source"
        position={Position.Right}
        isConnectableEnd={false}
        className="pdp-connect-handle"
        title="Drag to another item to create a relationship"
        style={{ width: 12, height: 12, right: -6, background: '#1976d2', border: '2px solid #fff', boxShadow: '0 0 0 1px #1976d2', cursor: 'crosshair', zIndex: 2 }}
      />
      {/* Always there, so xyflow has measured it before a drag starts; it only
          takes the drop (and the pointer) while a drag is on and this node is valid. */}
      <Handle
        id={TARGET_HANDLE_ID}
        type="target"
        position={Position.Left}
        isConnectableStart={false}
        isConnectableEnd={state.valid}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          transform: 'none',
          borderRadius: 8,
          opacity: 0,
          border: 'none',
          background: 'transparent',
          minWidth: 0,
          minHeight: 0,
          pointerEvents: state.valid ? 'all' : 'none',
          zIndex: state.valid ? 3 : -1,
        }}
      />
    </>
  );
}

/** The dashed line drawn while dragging. */
export const CONNECTION_LINE_STYLE = { stroke: '#1976d2', strokeWidth: 2, strokeDasharray: '6 4' };
