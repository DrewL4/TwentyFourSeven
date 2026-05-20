import ChannelRedirectClient from "./redirect-client";

/** Static export: prebuild placeholder; nginx serves /channels/index.html for other ids */
export function generateStaticParams() {
  return [{ id: "redirect" }];
}

export default function ChannelRedirectPage() {
  return <ChannelRedirectClient />;
}
