import type { Bot, Context } from "../max/compat.js";

export interface MaxClientConfig {
  token?: string;
}

export type MaxBotOptions = NonNullable<ConstructorParameters<typeof Bot<Context>>[1]>;

/** MAX has no proxy/IPv4 client switches; the SDK accepts an empty option set. */
export function createMaxBotOptions(_config: MaxClientConfig): MaxBotOptions {
  return {};
}
