import { RefreshScope } from "@/shared/contracts/common";

export type RefreshRequest = {
  scope: RefreshScope;
  reason: string;
  targets: string[];
};
