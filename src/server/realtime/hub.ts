import { Client } from "pg";
import type { RealtimeEnvelope } from "@/server/events";

type Listener = (message: RealtimeEnvelope) => void;

/**
 * Una conexión LISTEN por proceso que reparte los mensajes de Postgres
 * entre las conexiones SSE abiertas en este servidor.
 */
class RealtimeHub {
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private retryMs = 1000;

  subscribe(channels: string[], listener: Listener): () => void {
    for (const channel of channels) {
      if (!this.listeners.has(channel)) this.listeners.set(channel, new Set());
      this.listeners.get(channel)!.add(listener);
    }
    void this.ensureConnected();
    return () => {
      for (const channel of channels) {
        const set = this.listeners.get(channel);
        set?.delete(listener);
        if (set && set.size === 0) this.listeners.delete(channel);
      }
    };
  }

  private ensureConnected(): Promise<void> {
    if (this.client) return Promise.resolve();
    if (!this.connecting) {
      this.connecting = this.connect().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  private async connect() {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    const reconnect = () => {
      if (this.client !== client) return;
      this.client = null;
      client.removeAllListeners();
      client.end().catch(() => {});
      const delay = this.retryMs;
      this.retryMs = Math.min(this.retryMs * 2, 30_000);
      setTimeout(() => {
        if (this.listeners.size > 0) void this.ensureConnected();
      }, delay);
    };
    client.on("notification", (msg) => {
      if (msg.channel !== "realtime" || !msg.payload) return;
      let envelope: RealtimeEnvelope;
      try {
        envelope = JSON.parse(msg.payload);
      } catch {
        return;
      }
      for (const listener of this.listeners.get(envelope.channel) ?? []) listener(envelope);
    });
    client.on("error", reconnect);
    client.on("end", reconnect);
    try {
      await client.connect();
      await client.query("LISTEN realtime");
      this.client = client;
      this.retryMs = 1000;
    } catch (err) {
      console.error("[realtime] no se pudo conectar a Postgres", err);
      this.client = client;
      reconnect();
    }
  }
}

const globalForHub = globalThis as unknown as { __realtimeHub?: RealtimeHub };
export const realtimeHub = (globalForHub.__realtimeHub ??= new RealtimeHub());
