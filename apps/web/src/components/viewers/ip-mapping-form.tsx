"use client";

import { useState } from "react";
import { orpc } from "@/utils/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Autocomplete } from "@/components/ui/combobox";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function IpMappingForm() {
  const [ipAddress, setIpAddress] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [userId, setUserId] = useState<string>("");
  const [blocked, setBlocked] = useState(false);
  const [useExistingUser, setUseExistingUser] = useState(false);
  const queryClient = useQueryClient();

  const { data: users } = useQuery(orpc.viewers.getUsers.queryOptions());
  const { data: unassignedIps } = useQuery(orpc.viewers.getUnassignedIps.queryOptions());
  const createMapping = useMutation(orpc.viewers.createMapping.mutationOptions());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!ipAddress.trim()) {
      toast.error("IP address is required");
      return;
    }

    if (useExistingUser && !userId) {
      toast.error("Please select a user or enter a name");
      return;
    }

    if (!useExistingUser && !name.trim()) {
      toast.error("Name is required when not using existing user");
      return;
    }

    try {
      const selectedUser = useExistingUser && userId ? users?.find(u => u.id === userId) : null;
      const finalName = useExistingUser && selectedUser ? selectedUser.name : name.trim();

      await createMapping.mutateAsync({
        ipAddress: ipAddress.trim(),
        name: finalName,
        notes: notes.trim() || undefined,
        userId: useExistingUser && userId ? userId : undefined,
        blocked: blocked,
      });

      toast.success("IP mapping created successfully");
      setIpAddress("");
      setName("");
      setNotes("");
      setUserId("");
      setBlocked(false);
      setUseExistingUser(false);
      
      // Invalidate queries to refresh lists
      queryClient.invalidateQueries({ queryKey: orpc.viewers.listMappings.queryOptions().queryKey });
      queryClient.invalidateQueries({ queryKey: orpc.viewers.getActive.queryOptions().queryKey });
      queryClient.invalidateQueries({ queryKey: orpc.viewers.getHistory.queryOptions({ input: {} }).queryKey });
      queryClient.invalidateQueries({ queryKey: orpc.viewers.getUnassignedIps.queryOptions().queryKey });
    } catch (error: any) {
      toast.error(error.message || "Failed to create IP mapping");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="ipAddress">IP Address</Label>
        {unassignedIps && unassignedIps.length > 0 ? (
          <Autocomplete
            options={unassignedIps}
            value={ipAddress}
            onValueChange={setIpAddress}
            placeholder="Type or select an IP address..."
            className="w-full"
          />
        ) : (
          <Input
            id="ipAddress"
            placeholder="192.168.1.100"
            value={ipAddress}
            onChange={(e) => setIpAddress(e.target.value)}
            required
          />
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="useExistingUser"
            checked={useExistingUser}
            onCheckedChange={(checked) => setUseExistingUser(checked === true)}
          />
          <Label htmlFor="useExistingUser" className="cursor-pointer">
            Assign to existing user
          </Label>
        </div>
      </div>

      {useExistingUser ? (
        <div className="space-y-2">
          <Label htmlFor="userId">User</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a user..." />
            </SelectTrigger>
            <SelectContent>
              {users?.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name} ({user.email})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
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
      )}

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

      <div className="flex items-center space-x-2">
        <Checkbox
          id="blocked"
          checked={blocked}
          onCheckedChange={(checked) => setBlocked(checked === true)}
        />
        <Label htmlFor="blocked" className="cursor-pointer">
          Block this IP address
        </Label>
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

