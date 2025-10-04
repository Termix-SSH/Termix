import React, { useState } from "react";
import { CardTitle } from "@/components/ui/card.tsx";
import { ChevronDown, Folder, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Host } from "@/ui/Desktop/Navigation/Hosts/Host.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { deleteFolder } from "@/ui/main-axios.ts";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";

interface SSHHost {
  id: number;
  name: string;
  ip: string;
  port: number;
  username: string;
  folder: string;
  tags: string[];
  pin: boolean;
  authType: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  enableTerminal: boolean;
  enableTunnel: boolean;
  enableFileManager: boolean;
  defaultPath: string;
  tunnelConnections: any[];
  createdAt: string;
  updatedAt: string;
}

interface FolderCardProps {
  folderName: string;
  hosts: SSHHost[];
  isFirst: boolean;
  isLast: boolean;
  onDelete?: () => void;
}

export function FolderCard({
  folderName,
  hosts,
  onDelete,
}: FolderCardProps): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = async () => {
    setIsDeleting(true);
    try {
      const result = await deleteFolder(folderName);
      toast.success(
        `Folder "${folderName}" and ${result.deletedHosts} host(s) deleted successfully`,
      );
      setShowDeleteDialog(false);
      if (onDelete) {
        onDelete();
      }
    } catch (error) {
      toast.error("Failed to delete folder");
      console.error("Delete folder error:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div className="bg-dark-bg-darker border-2 border-dark-border rounded-lg overflow-hidden p-0 m-0">
        <div
          className={`px-4 py-3 relative ${isExpanded ? "border-b-2" : ""} bg-dark-bg-header`}
        >
          <div className="flex gap-2 pr-20">
            <div className="flex-shrink-0 flex items-center">
              <Folder size={16} strokeWidth={3} />
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="mb-0 leading-tight break-words text-md">
                {folderName}
              </CardTitle>
            </div>
          </div>
          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex gap-2">
            <Button
              variant="outline"
              className="w-[28px] h-[28px] flex-shrink-0 hover:bg-destructive hover:text-destructive-foreground"
              onClick={handleDeleteClick}
              title="Delete folder and all hosts"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="w-[28px] h-[28px] flex-shrink-0"
              onClick={toggleExpanded}
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${isExpanded ? "" : "rotate-180"}`}
              />
            </Button>
          </div>
        </div>
      {isExpanded && (
        <div className="flex flex-col p-2 gap-y-3">
          {hosts.map((host, index) => (
            <React.Fragment
              key={`${folderName}-host-${host.id}-${host.name || host.ip}`}
            >
              <Host host={host} />
              {index < hosts.length - 1 && (
                <div className="relative -mx-2">
                  <Separator className="p-0.25 absolute inset-x-0" />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      )}
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Folder</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the folder "{folderName}" and all{" "}
              {hosts.length} host(s) inside it? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
