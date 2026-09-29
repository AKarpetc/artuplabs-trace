import { view } from '@forge/bridge';

/** Enables Confluence theming and returns the Forge view context. */
export async function bootstrap() {
  await view.theme.enable();
  const context = await view.getContext();
  return { context };
}
