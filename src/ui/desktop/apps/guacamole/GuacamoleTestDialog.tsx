import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PasswordInput } from "@/components/ui/password-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Monitor, MonitorPlay, Terminal } from "lucide-react";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext";
import type { GuacamoleConnectionConfig } from "./GuacamoleDisplay";

interface GuacamoleTestDialogProps {
  trigger?: React.ReactNode;
}

export function GuacamoleTestDialog({ trigger }: GuacamoleTestDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { addTab } = useTabs();

  const [connectionType, setConnectionType] = useState<"rdp" | "vnc" | "telnet">("rdp");
  const [hostname, setHostname] = useState("");
  const [port, setPort] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [domain, setDomain] = useState("");
  const [security, setSecurity] = useState("nla");

  const defaultPorts = { rdp: "3389", vnc: "5900", telnet: "23" };

  const handleConnect = () => {
    if (!hostname) return;

    const config: GuacamoleConnectionConfig = {
      type: connectionType,
      hostname,
      port: parseInt(port || defaultPorts[connectionType]),
      username: username || undefined,
      password: password || undefined,
      domain: domain || undefined,
      security: connectionType === "rdp" ? security : undefined,
      "ignore-cert": true,
    };

    // Add a new tab for the remote desktop connection
    const tabType = connectionType === "rdp" ? "rdp" : connectionType === "vnc" ? "vnc" : "rdp";
    const title = `${connectionType.toUpperCase()} - ${hostname}`;

    addTab({
      type: tabType,
      title,
      connectionConfig: config,
    });

    // Close the dialog
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" className="gap-2">
            <Monitor className="w-4 h-4" />
            Test RDP/VNC
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Monitor className="w-5 h-5" />
            Remote Connection
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
            <Tabs value={connectionType} onValueChange={(v) => {
              setConnectionType(v as "rdp" | "vnc" | "telnet");
              setPort("");
            }}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="rdp" className="gap-1">
                  <MonitorPlay className="w-4 h-4" /> RDP
                </TabsTrigger>
                <TabsTrigger value="vnc" className="gap-1">
                  <Monitor className="w-4 h-4" /> VNC
                </TabsTrigger>
                <TabsTrigger value="telnet" className="gap-1">
                  <Terminal className="w-4 h-4" /> Telnet
                </TabsTrigger>
              </TabsList>

              <TabsContent value="rdp" className="space-y-3 mt-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Hostname / IP</Label>
                    <Input value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="192.168.1.100" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Port</Label>
                    <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="3389" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Domain (optional)</Label>
                    <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="WORKGROUP" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Security</Label>
                    <Select value={security} onValueChange={setSecurity}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nla">NLA (Windows 10/11)</SelectItem>
                        <SelectItem value="tls">TLS</SelectItem>
                        <SelectItem value="rdp">RDP (legacy)</SelectItem>
                        <SelectItem value="any">Auto-negotiate</SelectItem>
                        <SelectItem value="vmconnect">Hyper-V</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Username</Label>
                    <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Administrator" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Password</Label>
                    <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="vnc" className="space-y-3 mt-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Hostname / IP</Label>
                    <Input value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="192.168.1.100" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Port</Label>
                    <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="5900" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Password</Label>
                  <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </TabsContent>

              <TabsContent value="telnet" className="space-y-3 mt-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Hostname / IP</Label>
                    <Input value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="192.168.1.100" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Port</Label>
                    <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="23" />
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            <Button onClick={handleConnect} disabled={!hostname} className="w-full">
              Connect
            </Button>
          </div>
      </DialogContent>
    </Dialog>
  );
}

