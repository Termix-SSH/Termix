import { describe, expect, it } from "vitest";
import {
  counterRate,
  parseNetworkCounters,
  parseDarwinIfconfig,
  parseDarwinNetstat,
} from "../../../../hosts/metrics/widgets/network-collector.js";

const PROC_NET = `Inter-|   Receive                                                |  Transmit
 face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed
  eth0: 1024 1 0 0 0 0 0 0 2048 2 0 0 0 0 0 0
    lo: 4096 4 0 0 0 0 0 0 4096 4 0 0 0 0 0 0`;

describe("network counters", () => {
  it("parses Linux proc counters", () => {
    expect(parseNetworkCounters(PROC_NET).get("eth0")).toEqual({
      rx: "1024",
      tx: "2048",
    });
  });

  it("calculates bytes per second and rejects counter resets", () => {
    expect(counterRate("1000", "2500", 0.5)).toBe(3000);
    expect(counterRate("2500", "1000", 0.5)).toBeNull();
  });
});

const DARWIN_IFCONFIG = `lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384
	inet 127.0.0.1 netmask 0xff000000
en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
	ether ac:de:48:00:11:22
	inet 192.168.1.5 netmask 0xffffff00 broadcast 192.168.1.255
	status: active
en1: flags=8822<BROADCAST,SMART,SIMPLEX,MULTICAST> mtu 1500
	ether ac:de:48:00:11:23
	status: inactive`;

const DARWIN_NETSTAT = `Name  Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0   16384 <Link#1>                        466472     0   62511610   466472     0   62511610     0
lo0   16384 127           127.0.0.1          466472     -   62511610   466472     -   62511610     -
en0   1500  <Link#4>    ac:de:48:00:11:22   123456     0  987654321    65432     0  123456789     0
en0   1500  192.168.1     192.168.1.5        123456     -  987654321    65432     -  123456789     -`;

describe("darwin network parsing", () => {
  it("parses interface addresses and up/down state from ifconfig", () => {
    const map = parseDarwinIfconfig(DARWIN_IFCONFIG);
    expect(map.has("lo0")).toBe(false);
    expect(map.get("en0")).toEqual({ ip: "192.168.1.5", state: "UP" });
    expect(map.get("en1")).toEqual({ ip: "", state: "DOWN" });
  });

  it("parses byte counters from the Link-layer netstat -ib row", () => {
    const counters = parseDarwinNetstat(DARWIN_NETSTAT);
    expect(counters.has("lo0")).toBe(false);
    expect(counters.get("en0")).toEqual({
      rx: "987654321",
      tx: "123456789",
    });
  });
});
