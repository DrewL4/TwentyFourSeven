"use client";

import { useState } from "react";
import { orpc } from "@/utils/orpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function IpMappingForm() {
  const [ipAddress, setIpAddress] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const queryClient = useQueryClient();

  const createMapping = useMutation(orpc.viewers.createMapping.mutationOptions());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!ipAddress.trim() || !name.trim()) {
      toast.error("IP address and name are required");
      return;
    }

    try {
      await createMapping.mutateAsync({
        ipAddress: ipAddress.trim(),
        name: name.trim(),
        notes: notes.trim() || undefined,
      });

      toast.success("IP mapping created successfully");
      setIpAddress("");
      setName("");
      setNotes("");
      
      // Invalidate queries to refresh lists
      queryClient.invalidateQueries({ queryKey: orpc.viewers.listMappings.queryOptions().queryKey });
      queryClient.invalidateQueries({ queryKey: orpc.viewers.getActive.queryOptions().queryKey });
      queryClient.invalidateQueries({ queryKey: orpc.viewers.getHistory.queryOptions({ input: {} }).queryKey });
    } catch (error: any) {
      toast.error(error.message || "Failed to create IP mapping");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="ipAddress">IP Address</Label>
        <Input
          id="ipAddress"
          placeholder="192.168.1.100"
          value={ipAddress}
          onChange={(e) => setIpAddress(e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          placeholder="John's TV"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea
          id="notes"
          placeholder="Additional information about this viewer..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
        />
      </div>

      <Button type="submit" disabled={createMapping.isPending} className="w-full">
        {createMapping.isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Creating...
          </>
        ) : (
          "Create Mapping"
        )}
      </Button>
    </form>
  );
}

