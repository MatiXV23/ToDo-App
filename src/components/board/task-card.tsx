"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Bot,
  CornerDownRight,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  ListChecks,
  MessageSquare,
  Paperclip,
} from "lucide-react";
import { memo } from "react";
import { EpicChip, KeyBadge, TagChip } from "@/components/common/chips";
import { DueDate } from "@/components/common/due-date";
import { PriorityIcon } from "@/components/common/priority-icon";
import { UserAvatar } from "@/components/common/user-avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type PrState, PR_STATE_META, taskKey } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { AGENT_STATUS } from "@/components/task/agent-banner";
import type { Board, BoardTask } from "./filters";

const AGENT_ICON: Record<string, string> = {
  claimed: "text-brand animate-pulse",
  pr_open: "text-amber-600",
  merged: "text-purple-600",
  blocked: "text-red-600",
};

const PR_ICONS: Record<PrState, { icon: typeof GitPullRequest; className: string }> = {
  draft: { icon: GitPullRequestDraft, className: "text-zinc-400" },
  open: { icon: GitPullRequest, className: "text-green-600" },
  in_review: { icon: GitPullRequest, className: "text-amber-600" },
  merged: { icon: GitMerge, className: "text-purple-600" },
  closed: { icon: GitPullRequestClosed, className: "text-red-500" },
};

export type CardLookups = {
  projectKey: string;
  members: Map<string, Board["members"][number]>;
  tags: Map<string, Board["tags"][number]>;
  epics: Map<string, Board["epics"][number]>;
  tasks: Map<string, BoardTask>;
};

type CardProps = { task: BoardTask; lookups: CardLookups; onOpen?: (key: string) => void; overlay?: boolean };

export const TaskCardBody = memo(function TaskCardBody({ task, lookups, overlay }: CardProps) {
  const key = taskKey(lookups.projectKey, task.number);
  const assignee = task.assigneeId ? lookups.members.get(task.assigneeId) : null;
  const epic = task.epicId ? lookups.epics.get(task.epicId) : null;
  const parent = task.parentId ? lookups.tasks.get(task.parentId) : null;
  const tags = task.tagIds.map((id) => lookups.tags.get(id)).filter((t) => !!t);
  const pr = task.prState ? PR_ICONS[task.prState as PrState] : null;
  const done = !!task.completedAt;

  return (
    <div
      className={cn(
        "group rounded-lg border bg-card p-2.5 text-left shadow-xs transition-shadow hover:border-foreground/20",
        overlay && "rotate-1 shadow-lg ring-1 ring-foreground/10",
      )}
    >
      {task.parentId ? (
        <div className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          <CornerDownRight className="size-3" />
          <span className="truncate">{parent ? taskKey(lookups.projectKey, parent.number) : "Subtarea"}</span>
        </div>
      ) : null}
      <p className={cn("line-clamp-3 text-sm leading-snug", done && "text-muted-foreground")}>{task.title}</p>
      {epic || tags.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {epic ? <EpicChip epic={epic} /> : null}
          {tags.slice(0, 3).map((tag) => (
            <TagChip key={tag.id} tag={tag} />
          ))}
          {tags.length > 3 ? <span className="text-[11px] text-muted-foreground">+{tags.length - 3}</span> : null}
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <PriorityIcon priority={task.priority} className="size-3.5" />
        <KeyBadge value={key} className={cn(done && "line-through")} />
        {task.subtaskTotal > 0 ? (
          <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
            <ListChecks className="size-3" />
            {task.subtaskDone}/{task.subtaskTotal}
          </span>
        ) : null}
        {task.commentCount > 0 ? (
          <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
            <MessageSquare className="size-3" />
            {task.commentCount}
          </span>
        ) : null}
        {task.attachmentCount > 0 ? (
          <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
            <Paperclip className="size-3" />
            {task.attachmentCount}
          </span>
        ) : null}
        {task.agentStatus ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Bot className={cn("size-3.5", AGENT_ICON[task.agentStatus] ?? "text-muted-foreground")} />
            </TooltipTrigger>
            <TooltipContent>{AGENT_STATUS[task.agentStatus]?.label ?? "Agente Claude"}</TooltipContent>
          </Tooltip>
        ) : null}
        {pr ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <pr.icon className={cn("size-3.5", pr.className)} />
            </TooltipTrigger>
            <TooltipContent>PR {PR_STATE_META[task.prState as PrState].label.toLowerCase()}</TooltipContent>
          </Tooltip>
        ) : null}
        {task.dueDate ? <DueDate date={task.dueDate} done={done} /> : null}
        <div className="ml-auto">{assignee ? <UserAvatar user={assignee} className="size-5" tooltip /> : null}</div>
      </div>
    </div>
  );
});

export function SortableTaskCard({ task, lookups, onOpen, disabled }: CardProps & { disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "task" },
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("touch-manipulation outline-none", isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
      onClick={() => onOpen?.(taskKey(lookups.projectKey, task.number))}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === "Enter" && !e.defaultPrevented) onOpen?.(taskKey(lookups.projectKey, task.number));
      }}
    >
      <TaskCardBody task={task} lookups={lookups} />
    </div>
  );
}
