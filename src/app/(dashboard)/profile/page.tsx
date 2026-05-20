import { requireUser } from "@/lib/auth";
import ProfileClient from "./ProfileClient";

export default async function ProfilePage() {
  const user = await requireUser();
  return (
    <ProfileClient
      user={{
        name: user.name,
        email: user.email,
        role: user.role as "admin" | "sales",
      }}
    />
  );
}
