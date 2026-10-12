import type { ReactNode } from "react";
import { Check, Sigma, Users, Wallet } from "lucide-react";
import type { MonthCell } from "@/lib/dashboard-model";
import { cn } from "@/lib/utils";
import { Chip } from "./ui";

// Four tiles (mockups/dashboard.html). "Planned" and "Settled" are always spelled out; a figure that is not recorded says so
// instead of showing zero (docs/pages.md).

function Stat({ icon, label, chip, value, children, risk }: { icon: ReactNode; label: string; chip?: ReactNode; value: ReactNode; children?: ReactNode; risk?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-card border bg-card px-4 py-3.5", risk && "border-signal/30")}>
      <p className="m-0 flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">{icon}{label}{chip && <span className="ml-auto">{chip}</span>}</p>
      <p className={cn("mt-1.5 text-[1.625rem] leading-[1.15] font-medium tracking-tight tabular-nums", risk && "text-signal")}>{value}</p>
      {children}
    </div>
  );
}
const Sub = ({ children, risk }: { children: ReactNode; risk?: boolean }) => <p className={cn("mt-1 text-xs text-muted-foreground", risk && "font-medium text-signal")}>{children}</p>;
const Small = ({ children }: { children: ReactNode }) => <small className="text-[0.9375rem] font-[450] tracking-normal text-muted-foreground">{children}</small>;

export interface TileData {
  /** null: the settled runs of the year could not be read completely. */
  months: { year: number; cells: MonthCell[]; settled: number } | null;
  toPay: { month: string; value: string | null; hiddenForRole: boolean; openExceptions: number; simulation: boolean } | null;
  paid: { year: number; value: string | null; payments: number; runs: number | null; hiddenForRole: boolean };
  workers: { total: number | null; employees: number | null; contractors: number | null; unspecified: number | null; unconfirmedWallets: number | null };
}

export function StatTiles({ data }: { data: TileData }) {
  const { months, toPay, paid, workers } = data;
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Stat icon={<Check aria-hidden className="size-4" />} label={`Months paid in ${months?.year ?? paid.year}`} value={months ? <>{months.settled} <Small>of 12</Small></> : <span className="text-base font-medium text-muted-foreground">Not available</span>}>
        {months ? <ol aria-label={`${months.year} months`} className="m-0 mt-2.5 grid list-none grid-cols-12 gap-[3px] p-0">
          {months.cells.map((c) => (
            <li key={c.month} title={c.label} className={cn("grid h-[22px] place-items-center rounded-chip text-[0.6875rem] font-medium", c.state === "settled" ? "bg-success-soft text-success" : c.state === "pending" ? "border border-dashed border-muted-foreground/60 text-muted-foreground" : "bg-secondary text-muted-foreground")}>
              <span aria-hidden>{c.letter}</span><span className="sr-only">{c.label}</span>
            </li>
          ))}
        </ol> : null}
        <Sub>{months ? `Calendar year ${months.year}, the year of the selected run. A month counts once a run ending in it is settled. Simulations never settle.` : "The settled runs of this year could not be read completely."}</Sub>
      </Stat>

      <Stat icon={<Wallet aria-hidden className="size-4" />} label={toPay ? `To pay in ${toPay.month}` : "To pay"} chip={<Chip>Planned</Chip>} value={toPay?.value ? <>{toPay.value} <Small>USDC</Small></> : <span className="text-base font-medium text-muted-foreground">{toPay ? (toPay.hiddenForRole ? "Not shown for your role" : "Not available yet") : "No run yet"}</span>} risk={!!toPay?.value && toPay.openExceptions > 0}>
        <Sub>{toPay?.value ? `Calculated net for this run. ${toPay.simulation ? "Simulation: nothing will be paid." : "Not paid until payments settle."}` : toPay?.hiddenForRole ? "Amounts are visible to payroll and payment roles." : "Shown once the run's calculation is validated."}</Sub>
        {toPay?.value && toPay.openExceptions > 0 && <Sub risk>{toPay.openExceptions} open exception{toPay.openExceptions === 1 ? "" : "s"} could change this figure</Sub>}
      </Stat>

      <Stat icon={<Sigma aria-hidden className="size-4" />} label={`Paid in ${paid.year}`} chip={<Chip tone="ok">Settled</Chip>} value={paid.value ? <>{paid.value} <Small>USDC</Small></> : <span className="text-base font-medium text-muted-foreground">{paid.hiddenForRole ? "Not shown for your role" : paid.runs === 0 ? "None settled yet" : "Not available"}</span>}>
        <Sub>{paid.runs === null ? "The settled runs could not be read completely." : paid.runs === 0 ? `No run ending in ${paid.year} has settled. Simulations never pay.` : paid.value ? `All ${paid.runs} settled run${paid.runs === 1 ? "" : "s"} ending in ${paid.year} · ${paid.payments} payment${paid.payments === 1 ? "" : "s"} · Arc testnet USDC, no real funds` : paid.hiddenForRole ? `${paid.runs} settled run${paid.runs === 1 ? "" : "s"} ending in ${paid.year}; amounts are visible to payroll and payment roles.` : `${paid.runs} settled run${paid.runs === 1 ? "" : "s"} ending in ${paid.year}; the total could not be read completely.`}</Sub>
      </Stat>

      <Stat icon={<Users aria-hidden className="size-4" />} label="Workers" value={workers.total ?? <span className="text-base font-medium text-muted-foreground">Not available</span>}>
        {workers.employees !== null && workers.contractors !== null
          ? <Sub>{workers.employees} employee{workers.employees === 1 ? "" : "s"} · {workers.contractors} contractor{workers.contractors === 1 ? "" : "s"}{workers.unspecified ? ` · ${workers.unspecified} type not set` : ""}</Sub>
          : <Sub>The employee and contractor split is visible to payroll and payment roles.</Sub>}
        {workers.unconfirmedWallets ? <Sub risk>{workers.unconfirmedWallets} payout wallet{workers.unconfirmedWallets === 1 ? "" : "s"} awaiting confirmation</Sub> : null}
      </Stat>
    </div>
  );
}
