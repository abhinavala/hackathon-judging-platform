import Link from "next/link";

// Public. Placeholder until Phase 4 gives the site a real front page.
export default function Home() {
  return (
    <main className="mx-auto w-full max-w-xl p-8">
      <h1 className="mb-4 text-xl font-semibold">Hackathon Judging</h1>
      <ul className="list-disc pl-6">
        <li>
          <Link href="/login">Sign in</Link>
        </li>
        <li>
          <Link href="/me">Your account</Link>
        </li>
      </ul>
    </main>
  );
}
