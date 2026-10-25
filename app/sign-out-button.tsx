// A plain form post: no client JavaScript needed.
export function SignOutButton() {
  return (
    <form action="/auth/signout" method="post">
      <button type="submit" className="rounded border px-3 py-1">
        Sign out
      </button>
    </form>
  );
}
