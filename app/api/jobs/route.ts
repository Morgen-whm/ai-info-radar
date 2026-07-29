import { listJobs } from "@/db/repository";
import { demoJobs } from "@/lib/demo-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const jobs = await listJobs(50);
    return Response.json({ jobs: jobs.length ? jobs : demoJobs });
  } catch {
    return Response.json({ jobs: demoJobs });
  }
}
