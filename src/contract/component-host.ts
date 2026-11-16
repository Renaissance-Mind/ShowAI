import {
  componentObjects,
  validateComponentContractData,
  type ComponentContract,
} from "./component-contract.mjs";
import { componentActivationIssue } from "./component-activation.mjs";
import type { ComponentReceipt } from "./component-runtime.mjs";
import { schemaIssue, assertComponentContent } from "./schema";
import { componentViewStateIssue } from "./component-context.mjs";
import {
  flattenOutline,
  type PageOutlineComponentProps,
} from "../document/page-outline.mjs";
export function outlineRuntimeServices(value: PageOutlineComponentProps) {
  const items = flattenOutline(value.outline.items);
  return {
    "outline.navigate": (id: unknown): ComponentReceipt => {
      if (typeof id !== "string")
        throw new Error("Outline navigation needs an item ID");
      if (!items.some((item) => item.id === id && item.navigable))
        return { status: "unhandled" };
      value.navigate(id);
      return { status: "handled" };
    },
    "outline.expand": (input: {
      id: string;
      expanded: boolean;
    }): ComponentReceipt => {
      if (
        !input ||
        typeof input.id !== "string" ||
        typeof input.expanded !== "boolean"
      )
        throw new Error("Outline expansion needs id and expanded");
      if (!items.some((item) => item.id === input.id))
        return { status: "unhandled" };
      value.setBranchExpanded(input.id, input.expanded);
      return { status: "handled" };
    },
    "outline.collapse": (): ComponentReceipt => {
      value.collapse();
      return { status: "handled" };
    },
  };
}

export function contractPayloadIssue(
  contract: ComponentContract,
  kind: string,
  name: string,
  value: unknown,
) {
  const schema =
    kind === "view"
      ? contract.view?.schema
      : kind === "event"
        ? contract.events?.find((entry) => entry.name === name)?.payload
        : kind === "input"
          ? contract.actions?.find((entry) => entry.name === name)?.input
          : contract.actions?.find((entry) => entry.name === name)?.output;
  return schema === undefined ? undefined : schemaIssue(schema, value);
}
export async function componentHostRequest(options: {
  contract: ComponentContract;
  data: Record<string, unknown>;
  operation: string;
  input: any;
  gesture?: boolean;
  services: Record<
    string,
    ((value: any) => ComponentReceipt | Promise<ComponentReceipt>) | undefined
  >;
}): Promise<ComponentReceipt> {
  const { contract, data, operation, input } = options;
  if (["data.update", "field.set"].includes(operation))
    assertComponentContent(input);
  else {
    const issue = componentViewStateIssue(input, {
      bytes: operation === "view.set" ? 16384 : 65536,
      depth: 20,
    });
    if (issue) throw new Error("Component operation: " + issue);
  }
  if (operation === "event.emit") {
    const event = contract.events?.find((entry) => entry.name === input?.name);
    if (!event) throw new Error("Undeclared component event");
    if (input.intent !== event.intent)
      throw new Error("Event intent differs from its declaration");
    if (event.entity && componentActivationIssue(input.target))
      throw new Error("Invalid component object identity");
    if (!event.entity && input.target !== null)
      throw new Error("This event does not declare an object target");
    const issue = contractPayloadIssue(
      contract,
      "event",
      input.name,
      input.payload,
    );
    if (issue) throw new Error(issue);
    if (
      event.entity &&
      (!input.target ||
        input.target.type !== event.entity ||
        !componentObjects(contract, data).some(
          (target) =>
            target.type === input.target.type &&
            target.scope === input.target.scope &&
            target.id === input.target.id,
        ))
    )
      throw new Error("Event target is missing from component data");
  }
  if (operation === "view.set") {
    if (!contract.view) throw new Error("Reading state is not declared");
    const issue =
      input === undefined
        ? undefined
        : contractPayloadIssue(contract, "view", "state", input);
    if (issue) throw new Error(issue);
  }
  if (operation === "data.update")
    validateComponentContractData(contract, input);
  if (
    ["event.emit", "navigation.open", "conversation.submit"].includes(
      operation,
    ) &&
    options.gesture === false
  )
    return { status: "unavailable", reason: "A reader gesture is required." };
  const service = Object.hasOwn(options.services, operation)
    ? options.services[operation]
    : undefined;
  if (!service)
    return {
      status: "unavailable",
      reason: "Host operation unavailable: " + operation,
    };
  return service(input);
}
export function replyComponentRequest(
  event: MessageEvent,
  source: Window | null | undefined,
  channel: string,
  options: Omit<
    Parameters<typeof componentHostRequest>[0],
    "operation" | "input"
  >,
) {
  if (
    !source ||
    event.source !== source ||
    event.data?.channel !== channel ||
    event.data?.type !== "showai:runtime-request"
  )
    return false;
  const { requestId, operation, input } = event.data;
  if (
    typeof requestId !== "string" ||
    requestId.length > 100 ||
    typeof operation !== "string"
  )
    return true;
  const reply = (result: ComponentReceipt) =>
    source.postMessage(
      { channel, type: "showai:runtime-result", requestId, result },
      "*",
    );
  componentHostRequest({ ...options, operation, input }).then(reply, (error) =>
    reply({ status: "failed", reason: String(error?.message ?? error) }),
  );
  return true;
}
