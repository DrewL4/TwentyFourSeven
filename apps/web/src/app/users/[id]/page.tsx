import UserPageClient from "./user-page-client";

/** Static export: prebuild one placeholder; nginx serves it for /users/<number>/ and the client reads the id from the address. */
export function generateStaticParams() {
  return [{ id: "person" }];
}

export default function UserPageRoute() {
  return <UserPageClient />;
}
