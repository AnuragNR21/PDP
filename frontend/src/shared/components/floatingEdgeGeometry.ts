import type { InternalNode } from "@xyflow/react";
import { Position } from "@xyflow/react";

function getNodeDimensions(node: InternalNode) {
  return {
    width: node.measured?.width ?? node.width ?? 1,
    height: node.measured?.height ?? node.height ?? 1,
  };
}

function getNodeCenter(node: InternalNode) {
  const { width, height } = getNodeDimensions(node);
  return {
    x: node.internals.positionAbsolute.x + width / 2,
    y: node.internals.positionAbsolute.y + height / 2,
  };
}

function getNodeIntersection(intersectionNode: InternalNode, targetNode: InternalNode) {
  const { width, height } = getNodeDimensions(intersectionNode);
  const intersectionCenter = getNodeCenter(intersectionNode);
  const targetCenter = getNodeCenter(targetNode);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const horizontalDistance = (targetCenter.x - intersectionCenter.x) / (2 * halfWidth);
  const verticalDistance = (targetCenter.y - intersectionCenter.y) / (2 * halfHeight);
  const normalizedHorizontal = horizontalDistance - verticalDistance;
  const normalizedVertical = horizontalDistance + verticalDistance;
  const scale = 1 / (Math.abs(normalizedHorizontal) + Math.abs(normalizedVertical));
  const scaledHorizontal = scale * normalizedHorizontal;
  const scaledVertical = scale * normalizedVertical;

  return {
    x: halfWidth * (scaledHorizontal + scaledVertical) + intersectionCenter.x,
    y: halfHeight * (-scaledHorizontal + scaledVertical) + intersectionCenter.y,
  };
}

function getEdgePosition(node: InternalNode, intersectionPoint: { x: number; y: number }) {
  const { width, height } = getNodeDimensions(node);
  const nodeTopLeft = node.internals.positionAbsolute;
  const distances = [
    { position: Position.Left, value: Math.abs(intersectionPoint.x - nodeTopLeft.x) },
    { position: Position.Right, value: Math.abs(intersectionPoint.x - (nodeTopLeft.x + width)) },
    { position: Position.Top, value: Math.abs(intersectionPoint.y - nodeTopLeft.y) },
    { position: Position.Bottom, value: Math.abs(intersectionPoint.y - (nodeTopLeft.y + height)) },
  ];

  return distances.sort((a, b) => a.value - b.value)[0].position;
}

export function getFloatingEdgeParams(sourceNode: InternalNode, targetNode: InternalNode) {
  const sourceIntersectionPoint = getNodeIntersection(sourceNode, targetNode);
  const targetIntersectionPoint = getNodeIntersection(targetNode, sourceNode);

  return {
    sourceX: sourceIntersectionPoint.x,
    sourceY: sourceIntersectionPoint.y,
    targetX: targetIntersectionPoint.x,
    targetY: targetIntersectionPoint.y,
    sourcePosition: getEdgePosition(sourceNode, sourceIntersectionPoint),
    targetPosition: getEdgePosition(targetNode, targetIntersectionPoint),
  };
}
