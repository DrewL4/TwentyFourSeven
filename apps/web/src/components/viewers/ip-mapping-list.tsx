"use client";

import { useState } from "react";
import { orpc } from "@/utils/orpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Edit, Loader2, Ban, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function IpMappingList() {
  const [editingMapping, setEditingMapping] = useState<any>(null);
  const [editForm, setEditForm] = useState({ name: "", notes: "", userId: "", blocked: false });
  const queryClient = useQueryClient();

  const { data: mappings, isLoading } = useQuery(
    orpc.viewers.listMappings.queryOptions()
  );

  const deleteMapping = useMutation(orpc.viewers.deleteMapping.mutationOptions());
  const updateMapping = useMutation(orpc.viewers.createMapping.mutationOptions());
  const blockIp = useMutation(orpc.viewers.blockIp.mutationOptions());
  const unblockIp = useMutation(orpc.viewers.unblockIp.mutationOptions());
  const { data: users } = useQuery(orpc.viewers.getUsers.queryOptions());

  const handleDelete = async (id: string, ipAddress: string) => {
    if (!confirm(`Are you sure you want to delete the mapping for ${ipAddress}?`)) {
      return;
    }

    try {
      await deleteMapping.mutateAsync({ id });
      toast.success("Mapping deleted successfully");
      queryClient.invalidateQueries({ queryKey: orpc.viewers.listMappings.queryOptions().queryKey });
      queryClient.invalidateQueries({ queryKey: orpc.viewers.getActive.queryOptions().queryKey });
      queryClient.invalidateQueries({ queryKey: orpc.viewers.getHistory.queryOptions({ input: {} }).queryKey });
    } catch (error: any) {
      toast.error(error.message || "Failed to delete mapping");
    }
  };

  const handleEdit = (mapping: any) => {
    setEditingMapping(mapping);
    setEditForm({ name: mapping.name, notes: mapping.notes || "", userId: mapping.userId || "", blocked: mapping.blocked || false });
  };

  const handleSaveEdit = async () => {
    if (!editingMapping) return;

    try {
      await updateMapping.mutateAsync({
        ipAddress: editingMapping.ipAddress,
        name: editForm.name.trim(),
        notes: editForm.notes.trim() || undefined,
        blocked: editForm.blocked,
        userId: editForm.userId || undefined,
      });

      toast.success("Mapping updated successfully");
      setEditingMapping(null);
      queryClient.invalidateQueries({ queryKey: orpc.viewers.listMappings.queryOptions().queryKey });
      queryClient.invalidateQueries({ queryKey: orpc.viewers.getActive.queryOptions().queryKey });
      queryClient.invalidateQueries({ queryKey: orpc.viewers.getHistory.queryOptions({ input: {} }).queryKey });
    } catch (error: any) {
      toast.error(error.message || "Failed to update mapping");
    }
  };

  const handleBlock = async (ipAddress: string) => {
    try {
      await blockIp.mutateAsync({ ipAddress });
      toast.success("IP address blocked");
      queryClient.invalidateQueries({ queryKey: orpc.viewers.listMappings.queryOptions().queryKey });
    } catch (error: any) {
      toast.error(error.message || "Failed to block IP");
    }
  };

  const handleUnblock = async (ipAddress: string) => {
    try {
      await unblockIp.mutateAsync({ ipAddress });
      toast.success("IP address unblocked");
      queryClient.invalidateQueries({ queryKey: orpc.viewers.listMappings.queryOptions().queryKey });
    } catch (error: any) {
      toast.error(error.message || "Failed to unblock IP");
    }
  };

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading mappings...</div>;
  }

  if (!mappings || mappings.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No IP mappings found. Create one to get started.
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border overflow-hidden">
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[120px]">IP Address</TableHead>
                <TableHead className="min-w-[100px]">Name</TableHead>
                <TableHead className="min-w-[100px]">User</TableHead>
                <TableHead className="min-w-[80px]">Status</TableHead>
                <TableHead className="min-w-[150px]">Notes</TableHead>
                <TableHead className="min-w-[100px]">Created</TableHead>
                <TableHead className="min-w-[140px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mappings.map((mapping) => {
                const assignedUser = mapping.userId ? users?.find(u => u.id === mapping.userId) : null;
                return (
                  <TableRow key={mapping.id}>
                    <TableCell className="font-mono text-xs sm:text-sm">{mapping.ipAddress}</TableCell>
                    <TableCell className="font-medium text-sm">{mapping.name}</TableCell>
                    <TableCell className="text-sm">
                      {assignedUser ? (
                        <span>{assignedUser.name}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {mapping.blocked ? (
                        <Badge variant="destructive" className="text-xs">Blocked</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[150px] sm:max-w-xs truncate text-sm">
                      {mapping.notes || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs sm:text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(mapping.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 sm:gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(mapping)}
                          className="touch-manipulation h-9 w-9 p-0"
                          title="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        {mapping.blocked ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleUnblock(mapping.ipAddress)}
                            disabled={unblockIp.isPending}
                            title="Unblock IP"
                            className="touch-manipulation h-9 w-9 p-0"
                          >
                            {unblockIp.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <CheckCircle className="w-4 h-4 text-green-600" />
                            )}
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleBlock(mapping.ipAddress)}
                            disabled={blockIp.isPending}
                            title="Block IP"
                            className="touch-manipulation h-9 w-9 p-0"
                          >
                            {blockIp.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Ban className="w-4 h-4 text-red-600" />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(mapping.id, mapping.ipAddress)}
                          disabled={deleteMapping.isPending}
                          className="touch-manipulation h-9 w-9 p-0"
                          title="Delete"
                        >
                          {deleteMapping.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!editingMapping} onOpenChange={() => setEditingMapping(null)}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg sm:text-xl">Edit IP Mapping</DialogTitle>
            <DialogDescription className="text-sm">
              Update the name and notes for {editingMapping?.ipAddress}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm">IP Address</Label>
              <Input value={editingMapping?.ipAddress} disabled className="touch-manipulation" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-user" className="text-sm">Assign to User (optional)</Label>
              <Select 
                value={editForm.userId || "__none__"} 
                onValueChange={(value) => setEditForm({ ...editForm, userId: value === "__none__" ? "" : value })}
              >
                <SelectTrigger className="touch-manipulation">
                  <SelectValue placeholder="Select a user..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {users?.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name} ({user.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-name" className="text-sm">Name</Label>
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                required
                className="touch-manipulation"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-notes" className="text-sm">Notes</Label>
              <Textarea
                id="edit-notes"
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                rows={3}
                className="touch-manipulation"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="edit-blocked"
                checked={editForm.blocked}
                onCheckedChange={(checked) => setEditForm({ ...editForm, blocked: checked === true })}
                className="touch-manipulation"
              />
              <Label htmlFor="edit-blocked" className="cursor-pointer text-sm">
                Block this IP address
              </Label>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
            <Button 
              variant="outline" 
              onClick={() => setEditingMapping(null)}
              className="touch-manipulation w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSaveEdit} 
              disabled={updateMapping.isPending}
              className="touch-manipulation w-full sm:w-auto"
            >
              {updateMapping.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

