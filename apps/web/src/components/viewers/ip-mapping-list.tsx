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
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>IP Address</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mappings.map((mapping) => {
              const assignedUser = mapping.userId ? users?.find(u => u.id === mapping.userId) : null;
              return (
                <TableRow key={mapping.id}>
                  <TableCell className="font-mono text-sm">{mapping.ipAddress}</TableCell>
                  <TableCell className="font-medium">{mapping.name}</TableCell>
                  <TableCell>
                    {assignedUser ? (
                      <span className="text-sm">{assignedUser.name}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {mapping.blocked ? (
                      <Badge variant="destructive">Blocked</Badge>
                    ) : (
                      <Badge variant="outline">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {mapping.notes || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(mapping.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(mapping)}
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

      <Dialog open={!!editingMapping} onOpenChange={() => setEditingMapping(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit IP Mapping</DialogTitle>
            <DialogDescription>
              Update the name and notes for {editingMapping?.ipAddress}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>IP Address</Label>
              <Input value={editingMapping?.ipAddress} disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-user">Assign to User (optional)</Label>
              <Select 
                value={editForm.userId || "__none__"} 
                onValueChange={(value) => setEditForm({ ...editForm, userId: value === "__none__" ? "" : value })}
              >
                <SelectTrigger>
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
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-notes">Notes</Label>
              <Textarea
                id="edit-notes"
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                rows={3}
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="edit-blocked"
                checked={editForm.blocked}
                onCheckedChange={(checked) => setEditForm({ ...editForm, blocked: checked === true })}
              />
              <Label htmlFor="edit-blocked" className="cursor-pointer">
                Block this IP address
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingMapping(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={updateMapping.isPending}>
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

