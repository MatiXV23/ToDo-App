import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  user: { name: string; image?: string | null } | null | undefined;
  className?: string;
  tooltip?: boolean;
};

export function UserAvatar({ user, className, tooltip = false }: Props) {
  const avatar = (
    <Avatar className={cn("size-6 text-[10px]", className)}>
      {user?.image ? <AvatarImage src={user.image} alt={user.name} referrerPolicy="no-referrer" /> : null}
      <AvatarFallback className="bg-muted font-medium text-muted-foreground">
        {user ? initials(user.name) : "?"}
      </AvatarFallback>
    </Avatar>
  );
  if (!tooltip || !user) return avatar;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{avatar}</TooltipTrigger>
      <TooltipContent>{user.name}</TooltipContent>
    </Tooltip>
  );
}
