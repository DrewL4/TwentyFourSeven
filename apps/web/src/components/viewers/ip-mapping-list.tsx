"use client";

import { useState } from "react";
import { orpc } from "@/utils/orpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Edit, Loader2 } from "lucide-react";
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

export default function IpMappingList() {
  const [editingMapping, setEditingMapping] = useState<any>(null);
  const [editForm, setEditForm] = useState({ name: "", notes: "" });
  const queryClient = useQueryClient();

  const { data: mappings, isLoading } = useQuery(
    orpc.viewers.listMappings.queryOptions()
  );

  const deleteMapping = useMutation(orpc.viewers.deleteMapping.mutationOptions());
  const updateMapping = useMutation(orpc.viewers.createMapping.mutationOptions());

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
    setEditForm({ name: mapping.name, notes: mapping.notes || "" });
  };

  const handleSaveEdit = async () => {
    if (!editingMapping) return;

    try {
      await updateMapping.mutateAsync({
        ipAddress: editingMapping.ipAddress,
        name: editForm.name.trim(),
        notes: editForm.notes.trim() || undefined,
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
              <TableHead>Notes</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mappings.map((mapping) => (
              <TableRow key={mapping.id}>
                <TableCell className="font-mono text-sm">{mapping.ipAddress}</TableCell>
                <TableCell className="font-medium">{mapping.name}</TableCell>
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
            ))}
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

