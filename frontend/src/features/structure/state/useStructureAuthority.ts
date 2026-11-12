import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  structureApi,
  type CreateCanonicalNodeCommand,
  type CreateRelationshipCommand,
  type ReparentNodeCommand,
  type UpdateCanonicalNodeCommand
} from "@/features/structure/api/structureApi";

const rootQueryKey = ["structure-roots"];

export function useRootNodes() {
  return useQuery({
    queryKey: rootQueryKey,
    queryFn: () => structureApi.listNodes()
  });
}

export function useNodeDetail(nodeId: string | null) {
  return useQuery({
    queryKey: ["structure-node-detail", nodeId],
    queryFn: () => structureApi.getNodeDetail(nodeId as string),
    enabled: Boolean(nodeId)
  });
}

export function useCreateNode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateCanonicalNodeCommand) => structureApi.createNode(payload),
    onSuccess: async (_result, payload) => {
      await queryClient.invalidateQueries({ queryKey: rootQueryKey });
      if (payload.parent_node_id) {
        await queryClient.invalidateQueries({ queryKey: ["structure-node-detail", payload.parent_node_id] });
      }
    }
  });
}

export function useUpdateNode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ nodeId, payload }: { nodeId: string; payload: UpdateCanonicalNodeCommand }) =>
      structureApi.updateNode(nodeId, payload),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: rootQueryKey });
      await queryClient.invalidateQueries({ queryKey: ["structure-node-detail", variables.nodeId] });
    }
  });
}

export function useReparentNode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ReparentNodeCommand) => structureApi.reparentNode(payload),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: rootQueryKey });
      await queryClient.invalidateQueries({ queryKey: ["structure-node-detail", variables.node_id] });
      if (variables.new_parent_node_id) {
        await queryClient.invalidateQueries({ queryKey: ["structure-node-detail", variables.new_parent_node_id] });
      }
    }
  });
}

export function useCreateRelationship() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateRelationshipCommand) => structureApi.createRelationship(payload),
    onSuccess: async (_result, payload) => {
      await queryClient.invalidateQueries({ queryKey: ["structure-node-detail", payload.source_node_id] });
      await queryClient.invalidateQueries({ queryKey: ["structure-node-detail", payload.target_node_id] });
    }
  });
}

export function useDeleteRelationship() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (relationshipId: string) => structureApi.deleteRelationship(relationshipId),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    }
  });
}
