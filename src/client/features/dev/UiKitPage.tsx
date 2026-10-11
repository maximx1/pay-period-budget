// Development-only reference page at /dev/ui: every shared primitive in one place, for
// checking them at different widths and in both colour schemes. Not part of the production build.
import { Inbox, Pencil, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Dialog, DialogActions } from "../../components/ui/Dialog.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Fab } from "../../components/ui/Fab.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { SegmentedControl } from "../../components/ui/SegmentedControl.tsx";
import { SelectField } from "../../components/ui/SelectField.tsx";
import { TextAreaField } from "../../components/ui/TextAreaField.tsx";
import { PasswordField, TextField } from "../../components/ui/TextField.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

export function UiKitPage() {
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [kind, setKind] = useState<"expense" | "income">("expense");

  return (
    <>
      <PageHeader
        title="UI kit"
        subtitle="Shared primitives. Development only."
        actions={<Button onClick={() => setDialogOpen(true)}>Open dialog</Button>}
      />

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <IconButton label="Edit">
            <Pencil className="size-5" aria-hidden />
          </IconButton>
          <IconButton label="Delete" variant="secondary">
            <Trash2 className="size-5" aria-hidden />
          </IconButton>
        </div>
      </Section>

      <Section title="Fields">
        <Card className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" placeholder="Bag of ice" />
          <TextField label="Amount" inputMode="decimal" hint="Dollars and cents" />
          <TextField label="With an error" defaultValue="nope" error="That doesn't look right" />
          <PasswordField label="Password" />
          <SegmentedControl
            label="Type"
            options={[
              { value: "expense", label: "Expense" },
              { value: "income", label: "Income" },
            ]}
            value={kind}
            onChange={setKind}
          />
          <SelectField
            label="Repeats"
            options={[
              { value: "month", label: "months" },
              { value: "week", label: "weeks" },
            ]}
          />
          <div className="sm:col-span-2">
            <TextAreaField label="Description" hint="Free text; links become clickable." />
          </div>
        </Card>
      </Section>

      <Section title="Feedback">
        <div className="flex flex-col gap-3">
          <Alert>Something needs your attention.</Alert>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => toast("Moved to Oct 16 – Oct 29, 2026")}>
              Show toast
            </Button>
            <Button variant="secondary" onClick={() => toast("Couldn't save. Try again.", { variant: "error" })}>
              Show error toast
            </Button>
          </div>
          {saved && <p className="text-sm text-muted">Dialog saved: {saved}</p>}
        </div>
      </Section>

      <Section title="Cards and empty state">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card>
            <p className="font-semibold">Card</p>
            <p className="mt-1 text-sm text-muted">Default padding, surface background, border.</p>
          </Card>
          <Card padding="none" className="md:col-span-1 xl:col-span-2">
            <EmptyState
              icon={Inbox}
              title="Nothing here yet"
              description="Empty lists show an icon, a title and a hint about what to do next."
              action={<Button variant="secondary">Do the thing</Button>}
            />
          </Card>
        </div>
      </Section>

      <Section title="Long content (for scrolling under the floating button)">
        <Card padding="none">
          <ul className="divide-y divide-border">
            {Array.from({ length: 24 }, (_, i) => (
              <li key={i} className="flex min-h-11 items-center justify-between px-4 text-sm">
                <span>Row {i + 1}</span>
                <span className="text-muted tabular-nums">$0.00</span>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Add transaction">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setSaved(String(new FormData(event.currentTarget).get("name")));
            setDialogOpen(false);
          }}
        >
          <TextField label="Name" name="name" data-autofocus />
          <TextField label="Amount" name="amount" inputMode="decimal" />
          <TextField label="Date and time" name="when" type="datetime-local" />
          <DialogActions>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Add</Button>
          </DialogActions>
        </form>
      </Dialog>

      <Fab label="Add" onClick={() => toast("Floating button pressed")}>
        <Plus className="size-6" aria-hidden />
      </Fab>
    </>
  );
}
