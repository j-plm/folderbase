import { appSettings } from "../../lib/appSettings";
import { useAppSettings } from "../../hooks/useAppSettings";
import type { NewViewDefaults } from "../../lib/commands";
import { Checkbox, Divider, Form, PaneFooter, PopUp, Row } from "./controls";

/**
 * Settings ▸ New Views: what a new view starts with. Existing views keep their
 * own, and each of these can still be changed in any view.
 */
export default function NewViewsPane() {
  const d = useAppSettings().new_views;
  const set = (change: Partial<NewViewDefaults>) => void appSettings.update({ new_views: change });
  const restore = () =>
    void appSettings.update({
      new_views: Object.fromEntries(Object.keys(d).map((k) => [k, null])) as Record<keyof NewViewDefaults, null>,
    });

  return (
    <>
      <p className="text-[11px] text-neutral-400 mb-4">What a new view starts with. Views you already have keep their own settings.</p>
      <Form>
        <Row label="Database view">
          <Checkbox checked={d.group_by_hierarchy} onChange={(on) => set({ group_by_hierarchy: on })}>
            Group by Hierarchy
          </Checkbox>
          <Checkbox checked={d.non_empty_columns} onChange={(on) => set({ non_empty_columns: on })}>
            Show Non-Empty Custom Properties
          </Checkbox>
          <Checkbox checked={d.wrap_multi_select} onChange={(on) => set({ wrap_multi_select: on })}>
            Wrap Multi-select values
          </Checkbox>
          <Checkbox checked={d.freeze_name} onChange={(on) => set({ freeze_name: on })}>
            Freeze Name
          </Checkbox>
        </Row>
        <Divider />
        <Row
          label="Files without a value"
          note="Where a new Hierarchy level puts files with nothing in its property. Conditional properties always start loose."
        >
          <PopUp
            value={d.no_value}
            choices={[
              { value: "folder", label: "In a “No …” folder" },
              { value: "loose", label: "Loose in the folder above" },
            ]}
            onChange={(v) => set({ no_value: v })}
          />
        </Row>
        <Row label="Hierarchy levels">
          <Checkbox checked={d.skip_single} onChange={(on) => set({ skip_single: on })}>
            Skip Single Folders
          </Checkbox>
          <Checkbox checked={d.show_all_values} onChange={(on) => set({ show_all_values: on })}>
            Show All Values
          </Checkbox>
        </Row>
      </Form>
      <PaneFooter onRestore={restore} />
    </>
  );
}
