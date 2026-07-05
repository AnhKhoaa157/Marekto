import { AdminGate } from "@/components/admin/admin-gate";
import { AdminShell } from "@/components/admin/admin-shell";
import {
  formatAdminCount,
  formatAdminDate,
} from "@/components/admin/admin-format";
import {
  AdminEmpty,
  AdminInlineError,
  AdminPagination,
  AdminSearchForm,
  AdminSectionHeading,
  AdminTableScroll,
} from "@/components/admin/admin-ui";
import {
  parseAdminPage,
  parseAdminPageSize,
  parseAdminSearch,
} from "@/lib/admin-console";
import {
  loadAdminUsers,
  recordAdminAudit,
  type AdminPaginatedResult,
} from "@/lib/admin-data";
import { getAdminSessionState } from "@/lib/admin-session";
import type { AdminUserSummary } from "@/lib/admin-console";
import { sanitizeWorkerLogReason } from "@/lib/worker-log";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Users | Admin Console",
  description: "Search accounts and review workspace membership.",
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function roleClassName(role: string): string {
  return role === "admin"
    ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
    : "border-zinc-700 bg-zinc-800 text-zinc-300";
}

function formatSystemRole(role: string): string {
  return role === "admin" ? "Admin" : "User";
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const state = await getAdminSessionState();

  if (state.status === "unauthenticated") {
    return <AdminGate variant="unauthenticated" />;
  }

  if (state.status === "forbidden") {
    return <AdminGate variant="forbidden" />;
  }

  const resolved = searchParams ? await searchParams : {};
  const params = {
    search: parseAdminSearch(firstParam(resolved.search)),
    page: parseAdminPage(firstParam(resolved.page)),
    pageSize: parseAdminPageSize(firstParam(resolved.pageSize)),
  };

  let result: AdminPaginatedResult<AdminUserSummary> | null = null;
  let error: string | null = null;

  try {
    result = await loadAdminUsers(params);
    await recordAdminAudit({
      adminUserId: state.identity.userId,
      action: "admin.users.list",
      targetType: "user_list",
      targetId: null,
      metadata: {
        surface: "ui",
        search: params.search,
        page: params.page,
        result_count: result.items.length,
        total: result.total,
      },
    });
  } catch (loadError) {
    error = sanitizeWorkerLogReason(loadError);
  }

  return (
    <AdminShell
      activeRoute="/admin/users"
      adminEmail={state.identity.email}
      eyebrow="System administration"
      title="Users"
    >
      <div className="space-y-6">
        <AdminSectionHeading
          title="Accounts"
          description="Safe account fields only. Password hashes are never read or shown."
        />

        <AdminSearchForm
          action="/admin/users"
          defaultValue={params.search}
          label="Search by email"
          placeholder="Search by email address"
        />

        {error ? (
          <AdminInlineError message={error} />
        ) : result && result.items.length === 0 ? (
          <AdminEmpty
            title={params.search ? "No users match this search" : "No users yet"}
            description={
              params.search
                ? "Clear the search or try a different email."
                : "Accounts will appear here once users register."
            }
          />
        ) : result ? (
          <>
            <article className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
              <AdminTableScroll>
                <thead className="border-b border-zinc-800 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="py-3 pr-4">Email</th>
                    <th className="py-3 pr-4">System role</th>
                    <th className="py-3 pr-4">Workspaces</th>
                    <th className="py-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {result.items.map((user) => (
                    <tr className="text-zinc-300" key={user.id}>
                      <td className="py-4 pr-4">
                        <span className="font-medium text-zinc-50">
                          {user.email}
                        </span>
                        <p className="text-xs text-zinc-500">ID {user.id}</p>
                      </td>
                      <td className="py-4 pr-4">
                        <span
                          className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${roleClassName(user.role)}`}
                        >
                          {formatSystemRole(user.role)}
                        </span>
                      </td>
                      <td className="py-4 pr-4 tabular-nums">
                        {formatAdminCount(user.membership_count)}
                      </td>
                      <td className="whitespace-nowrap py-4 text-zinc-400">
                        {formatAdminDate(user.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AdminTableScroll>
            </article>

            <AdminPagination
              basePath="/admin/users"
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              search={params.search}
            />
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}
