import React from "react";
import { Input } from "@/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Search, Filter } from "lucide-react";
import type { DockerContainer } from "@/types/index.js";
import { ContainerCard } from "./ContainerCard.tsx";

interface ContainerListProps {
  containers: DockerContainer[];
  sessionId: string;
  onSelectContainer: (containerId: string) => void;
  selectedContainerId?: string | null;
  onRefresh?: () => void;
}

export function ContainerList({
  containers,
  sessionId,
  onSelectContainer,
  selectedContainerId = null,
  onRefresh,
}: ContainerListProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");

  const filteredContainers = React.useMemo(() => {
    return containers.filter((container) => {
      const matchesSearch =
        container.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        container.image.toLowerCase().includes(searchQuery.toLowerCase()) ||
        container.id.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === "all" || container.state === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [containers, searchQuery, statusFilter]);

  const statusCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    containers.forEach((c) => {
      counts[c.state] = (counts[c.state] || 0) + 1;
    });
    return counts;
  }, [containers]);

  if (containers.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <p className="text-gray-400 text-lg">No containers found</p>
          <p className="text-gray-500 text-sm">
            Start by creating containers on your server
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Search and Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search by name, image, or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-2 sm:min-w-[200px]">
          <Filter className="h-4 w-4 text-gray-400" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({containers.length})</SelectItem>
              {Object.entries(statusCounts).map(([status, count]) => (
                <SelectItem key={status} value={status}>
                  {status.charAt(0).toUpperCase() + status.slice(1)} ({count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Container Grid */}
      {filteredContainers.length === 0 ? (
        <div className="flex items-center justify-center flex-1">
          <div className="text-center space-y-2">
            <p className="text-gray-400">No containers match your filters</p>
            <p className="text-gray-500 text-sm">
              Try adjusting your search or filter
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 overflow-auto pb-2">
          {filteredContainers.map((container) => (
            <ContainerCard
              key={container.id}
              container={container}
              sessionId={sessionId}
              onSelect={() => onSelectContainer(container.id)}
              isSelected={selectedContainerId === container.id}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}
