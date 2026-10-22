# Virtual Folder System

**Product Specification — Version 1.0**

---

## Contents

- [Overview](#overview)
- [Core Concepts](#core-concepts)
  - [1. File Storage](#1-file-storage)
  - [2. The Database](#2-the-database)
  - [3. The Property Registry](#3-the-property-registry)
  - [4. Views and View Persistence](#4-views-and-view-persistence)
- [Virtual Folder Layer](#virtual-folder-layer)
- [Key UI Features](#key-ui-features)
- [Storage Management Features](#storage-management-features)
- [Local Desktop Application](#local-desktop-application)
- [Architecture Summary](#architecture-summary)
- [UI Architecture](#ui-architecture)
- [Future Considerations](#future-considerations)

---

## Overview

A local desktop file management system that decouples physical file storage from logical navigation. Files are stored on disk and referenced by a single lightweight SQLite database, with all organisation, metadata, and navigation handled at the database layer. A configurable virtual folder interface sits on top, allowing users to navigate their files in any number of ways without ever moving, duplicating, or restructuring the underlying files.

The system is designed to run entirely offline as a native desktop application. No account, server, or internet connection is required.

---

## Core Concepts

### 1. File Storage

Files are stored in one or more directories on the local machine — referred to as **root directories**. The physical folder structure within a root is flexible:

- Files may exist in a completely flat structure (all in one directory)
- Files may exist in an arbitrary nested folder structure carried over from prior organisation
- The system does not require or enforce any particular physical layout
- Files are referenced internally by a unique ID; their physical path is tracked but not semantically meaningful to the virtual layer

Over time, as the virtual interface becomes the primary means of navigation, the physical structure becomes increasingly irrelevant. Users may choose to **flatten** the root directory at any point — consolidating all files into a single flat folder — with no impact on the virtual layer or user experience. This is an optional housekeeping operation, not a requirement.

### 2. The Database

The entire system is backed by a **single SQLite database file**. All files across all domains — photos, documents, videos, and any other type — are stored as records in one `files` table. Domain separation is handled by a `library` property on each record, not by database structure.

This approach means:

- There is one database to back up, move, or inspect
- Cross-domain queries and views work without any special handling
- New file types or domains can be introduced without any schema changes
- The database can be fully rebuilt by re-crawling the root directories if lost

#### Schema

The core table is intentionally minimal:

```
files
─────────────────────────────────────────────────────
file_id     TEXT  PRIMARY KEY   Unique identifier
file_path   TEXT               Absolute path to the file on disk
file_type   TEXT               MIME type / extension
timestamp   TEXT               Date/time the file was created or captured
library     TEXT               Domain label (e.g. "photos", "documents")
metadata    JSON               All additional properties — standard and custom
```

#### The Metadata JSON Column

All properties beyond the core columns live in the `metadata` JSON field. This includes both properties that apply broadly across a domain and highly specific custom properties:

```json
{
  "year": 2024,
  "month": "March",
  "iso": 800,
  "focal_length": "35mm",
  "rig": "Rig-A",
  "component": "Component-B",
  "angle": "Front",
  "project": ["Apollo", "Hermes"]
}
```

SQLite's JSON functions allow querying and filtering on any of these fields. Multi-value properties (arrays) allow a file to appear under multiple virtual folders simultaneously without duplication.

There is no fixed schema for the metadata column. Each library defines the properties relevant to its domain, and new properties can be introduced at any time simply by using them. If a property becomes heavily queried, a database index can be added to the JSON path for performance — no structural changes required.

#### Database as a Restorable Cache

The database is treated as a derived artefact, not a primary one. Standard metadata (timestamps, file types, EXIF data) can be re-extracted automatically from the files themselves. Custom metadata — properties assigned by the user — cannot be recovered from the files and represents the only irreplaceable data in the system. Regular database backups alongside the files are strongly recommended.

### 3. The Property Registry

The metadata JSON column handles storage flexibly, but on its own it has no self-knowledge. The UI needs to answer questions like: what properties are valid for files in this library? What values are available for a given property? Is this property a fixed enumeration or free text? Without a vocabulary layer, these questions can only be answered by scanning all existing records at runtime — which is slow, incomplete for new properties, and provides no way to distinguish intentional structure from incidental data.

To address this, the database includes a lightweight **property registry**: a small set of additional tables in the same `.db` file that describe the properties and values in use. This is a UI and navigation concern only — it does not constrain what can be stored in the JSON column, and its absence would not corrupt any file data.

#### Registry Schema

```
properties
─────────────────────────────────────────────────────
property_id    TEXT  PRIMARY KEY
name           TEXT               e.g. "rig", "angle", "project"
library        TEXT  (nullable)   scoped to a library, or NULL for global
value_type     TEXT               "free_text" | "number" | "date" | "enum" | "array"
config         JSON  (nullable)   Type options, e.g. {"format": "currency", "currency": "GBP"}

property_values
─────────────────────────────────────────────────────
value_id       TEXT  PRIMARY KEY
property_id    TEXT  FK → properties
value          TEXT               e.g. "Rig-A", "Front", "Apollo"
```

`value_type` controls how the UI presents and edits the property. The user-facing names are the standard database field types:

| Type (UI) | `value_type` | Stored as | Editing |
|-----------|--------------|-----------|---------|
| Text | `free_text` | JSON string | Free text input |
| Number | `number` | JSON number | Numeric input; `config.format` is `generic`, `currency` (with `config.currency`, an ISO 4217 code) or `percent` (stored as a fraction, 0.25 = 25%) |
| Date | `date` | ISO date string (`YYYY-MM-DD`) | Date picker. **Date Format** (header menu) sets how it shows: Short, Medium (the default), Long and Full follow the system's date styles; ISO 8601; Relative ("yesterday", "in 3 days" within a week, else Medium); or Custom… with a pattern (`DD/MM/YYYY`, `D MMM YY`, `dddd D MMMM`; other words in [brackets]), previewed as it's typed. Stored as `config.dateFormat`; only the display changes |
| Dropdown | `enum` | JSON string | One value from the registered list, with "Add value" |
| Multi-select | `array` | JSON array of strings | Any number of values from the registered list, with "Add value". The type that gives multi-folder presence |

Changing a property's type converts the values already stored, never discarding them: a single value becomes a one-item list, a list becomes its values joined with commas, and text that reads as a number becomes a number. Values that cannot be converted are kept as they are and shown as entered.

Formula fields and units on numbers are deferred, not rejected; `config` is where they will live.

#### Bootstrapping from Existing Data

When a library is first imported, the registry can be partially populated automatically by inspecting the metadata keys already present across all ingested records. If thousands of photo records share a `"rig"` key, the system surfaces `rig` as a candidate property for the photos library without requiring the user to define it manually. The registry then makes that implicit structure explicit and editable.

#### Creating Properties and Values Through Navigation

Users do not need to define properties up front via a settings screen. The registry grows naturally through use. When navigating to a leaf context in a view and creating a folder at that level, the user is effectively declaring a new property value — or a new property dimension entirely:

- The user is at `2024 → Rig-A → Component-B` (current leaf level)
- They create a new folder named `Front` at this level
- The system checks the registry: if a property already governs this layer of the view, `Front` is added as a new value for that property. If no property is yet assigned to this layer, the user is prompted to name the property (e.g. `angle`), and both the property and its first value are created together
- Dragging files into `Front` assigns `"angle": "Front"` to those files via the contextual upload mechanism

This means folder creation at any level of the virtual tree is the primary way the property vocabulary grows. The registry records the result; the user never interacts with it directly as a configuration surface.

#### Tags, Properties and Scoped Properties

*Built in the database view (registry, implied values, cell states, promotion, removal prompt); the folder-view parts ([Scoped properties in views](#scoped-properties-in-views)) wait for views to return to the UI.*

Three roles are kept distinct:

| Role | What it is | Example |
|------|-----------|---------|
| **Tag** | A flat label: "this is about X". Hand-added tags are values of the built-in **Tags** property; **source tags** are the folder names on a file's path | `housing` |
| **Property** | A question that can be asked of a file | *Housing*: "what kind of housing document?" |
| **Value** | One answer to a property | `Rent`, `House Insurance` |

A tag is a virtual folder: opening `housing` shows every file with that tag. It is a different presentation of a filter, and properties make that filter richer and multi-level.

##### Independent and scoped properties

- An **independent** property applies to every file (Client, Year, Kind). Any combination of values is meaningful, so independent properties can be stacked in a view in any order
- A **scoped** property applies only where a condition holds: *Housing* **applies when** Tags has `housing`. The condition is one or more values of other properties, combined with *any*: *Insurance Type* can apply when Tags has `housing` or `car`. Scoping is a statement about meaning, not about position in a tree

This is the single link between properties. It is what "promoting a tag" creates, and it is how a property can also be a value of another property: *Housing* can be a property in its own right and the property that refines the `Housing` value of *Category*, or of Tags.

Rules:

- **No cycles**: a property cannot apply when another holds a value if that other property is itself scoped to it, directly or through others
- **Several conditions are allowed**: a property may refine values of more than one property, or several values of one. A strict one-parent tree is deliberately not required, because real categories cross over (insurance for a house and for a car)
- **Widening is lossless**: a scoped property can be made independent ("applies to all files") at any time without changing any file's values, so a wrong first guess is cheap to correct
- **Same names are linked, never accidental**: creating a property whose name matches an existing value (or the reverse) offers to link the two rather than leaving unrelated things with one name

The link lives in the property registry, not in views, because it is a fact about meaning that holds in every view. Views use it as their default structure and can still be arranged freely.

##### Implied rules

- **A value implies its condition**: giving a file a *Housing* value adds `housing` to its Tags. The implied tag is shown like a covered tag (faded) rather than stored a second time. Filters, sorting and grouping count implied values as held
  - Only a property with a **single** condition implies it: with several (`housing` or `car`), which one holds is unknown, so nothing is implied
  - A value is implied into a single-value (Select) property only while that property is empty; it never replaces a value
- **A condition without a value is a real state**: a file tagged `housing` with no *Housing* value yet is "about housing, not yet classified". It sits loose in the `housing` folder, not in any of its child folders, and is listed as incomplete
- **A tag set by hand is stored**: if the user adds `housing` directly, it is stored, so clearing *Housing* later leaves the file tagged `housing` rather than untagged. A tag that is only implied disappears when the value is cleared
- **Removing an implying tag asks first**: removing `housing` from a file that has a *Housing* value prompts that this also clears *Housing* (and any properties scoped beneath it), as one undoable change. The picker tells the two apart as the cell does: a value set directly has a ✓; one held only by implication has a faded ✓ and "from House" beside it; one that's both reads "also from House". Opening and closing the picker changes nothing. Clicking an implied value steps through three states: implied (faded ✓) → set directly (✓, so it stays if House is cleared) → unticked (on closing, asks before clearing House) → implied again. Other values tick and untick as usual. In a Select, picking a different value drops an implied one the same way. A property keeps its value if another of its conditions still holds. Bulk edits (paste, fill, Delete) don't prompt: they change only stored values, and implied ones stay shown

##### Cells and pills

- A scoped property's cell shows three states:
  - **Has a value**: the value, as usual
  - **Expected**: the condition holds but there is no value, shown as a muted "Choose…" placeholder with a dashed outline
  - **Doesn't apply**: the condition doesn't hold, shown as a greyed "—". Setting a value here anyway adds the implied tag, so the property starts to apply
- Pills stay single-colour. State is shown by tone and a glyph, not by extra colours:
  - **Faded**: the tag is covered, because a property's value already records it (as for source tags today)
  - **Trailing "›"** (`housing ›`): the value opens into a scoped property. This is also what marks it as a folder with more structure inside
- A scoped property's **header** shows its origin in a muted tone after the name; hovering gives the full condition ("Applies when Tags has Car"). Each condition shows its value, with the property it's in unless that's Tags (the usual source); a value that only repeats the header's name shows its source instead:
  - *Housing ‹ home*: Tags has `home`
  - *Car ‹ Tags*: Tags has `Car` (not "Car ‹ Car")
  - *Insurance Type ‹ Housing: House Insurance*
  - *Cover ‹ housing, car*: either

##### Promoting a tag

Dragging a tag or value pill (the existing 0.5s hold to arm) chooses what it becomes by where it's dropped. The drop hint always names the outcome, because some targets sit close together:

| Drop target | Result |
|-------------|--------|
| A **property's header** | Opens the dialog with that property's name, so Return **links** the tag to it (it gains the tag as a condition). Changing the name makes a new property instead |
| **Between two headers** (within 10px of the edge; a blue insertion line shows where) | Opens the dialog with the tag's name, capitalised, and the type (Select or Multi-select). The new property's column goes at that point |
| The **"+"** header, or a header that can't take it (Name, Size…, the tag's own column) | As between headers: a new property, at the end or just after that column |
| A property's **column** (any cell) | The tag becomes a value of that property (as before) |
| The **"+"** column below its header, or the empty area **to the right of the table** | The tag becomes a value of a new Multi-select (as dropping on "+" did before) |

- Right-click a pill ▸ **Make Property from "housing"…** opens the same dialog
- The dialog always shows the name, so the outcome can be changed either way with one edit: a name that matches an existing property **links** (no type choice; the title reads "Link "housing" to Housing"), and any other name **creates** a property (type shown)
- From the pill menu, the new column goes just after the column the tag came from
- **A source tag** is a folder name, so its folders are mapped into Tags first and the condition is Tags has `housing`; that keeps holding on every refresh, and the source tag shows covered. Folders already mapped to a property make that property's value the condition instead
- **Scoping an existing property** (the reverse of promotion: property first, tag second): header menu ▸ **Apply Only Where…** opens a list of conditions, each "*Property* has *value*" (Select and Multi-select properties only, combined with *or*), with Add Condition. Properties that depend on this one aren't offered, as they would make a cycle. The dialog says what the scope would do before applying: "Applies to 3 of 5 files: 2 with a value, 1 to fill in. Files given a Housing value also get "housing"". Not offered for the built-in Tags property, which stays a set of flat labels
- **Widening**: a scoped property's header menu has **Apply to All Files (not just housing)**, which removes its conditions
- **Unlinking one value**: right-click a pill that opens into a property (`housing ›`) ▸ **Unlink "housing" from Housing** removes just that condition; with none left, the property applies to all files
- **Removing a link keeps what it showed**: values a condition was implying (a faded `housing` on files with a Housing value) are written as stored values when the condition goes, by Unlink, Apply to All Files or Apply Only Where…, so no file loses a tag it was showing. One undo restores both the link and the files
- **Independent properties never imply tags.** A property only implies values where it has been scoped, by promotion or Apply Only Where…. A tag named after every property with a value would repeat the column headers on most files and bury the tags chosen by hand
- All of these are undoable (Make Property, Apply Only Where, Apply to All Files)
- In grouping, a scoped property's files it doesn't apply to form a **Doesn't Apply** group, separate from the "No *Property*" group of files still missing a value

##### Storage

`property_scopes (property_id, condition_property_id, value)`, one row per condition; no rows means the property applies to every file. `set_property_scope` replaces a property's conditions and refuses a cycle. Conditions follow their values: renaming a value or moving it to another property moves its conditions, and deleting a value or property removes them.

##### Scoped properties in views

Because scoping is a condition rather than a position, views can still order levels freely:

| View order | Result |
|------------|--------|
| Tags › Housing | `housing/` holds Rent and House Insurance, plus the files tagged `housing` with no value yet. Other tags have no Housing level: it doesn't apply there |
| Tags › Year › Housing | Housing appears under `housing/2024/`: the condition holds in that branch. The levels need not be adjacent |
| Housing › Tags | Putting a scoped property first narrows the view to the files it applies to. Inside `Rent/`, Tags still splits by the files' other tags (`tax`, `2024`); `housing` is the same for all of them |

- **Forks are derived**: a branch's next level only offers properties that apply there, so the Photos/Videos split in [Forking Hierarchies](#forking-hierarchies) follows from *Rig* applying to photos and *Project* to videos, without declaring the fork in the view
- **Dropping into a folder** sets every condition on its path, whatever the view's order: dropping into `housing/Rent` adds the tag and sets *Housing* = Rent
- **Dragging out of a folder** is the ambiguous direction (which condition should go?), so "Remove from this folder" removes only the deepest level's value and the removal prompt above covers implied tags

#### Registry as a Restorable Artefact

Like the rest of the database, the registry can be reconstructed by crawling existing metadata values across all file records. It is not a source of truth about which values *exist* — the file records themselves carry that — but rather a description of the intended structure. If lost, it can be regenerated from the data, though any type annotations (`enum` vs `free_text`, etc.) would need to be re-applied manually.

### 4. Views and View Persistence

A **view** is a saved hierarchy configuration defining how files are navigated. Views are first-class records in the database — not configuration files or application preferences — so they travel with the database when it is backed up or moved.

A view is not a flat list of layers. It is a **tree of layer nodes**, where each node defines the property used to group files at that depth, and where any node may fork into multiple independent sub-trees based on the values present at that level. This tree structure is what gets persisted.

#### View Schema

```
views
─────────────────────────────────────────────────────
view_id        TEXT  PRIMARY KEY
name           TEXT               Display name (e.g. "By Rig & Component")
library        TEXT  (nullable)   Scoped to a library, or NULL for cross-library
created_at     TEXT
updated_at     TEXT

view_nodes
─────────────────────────────────────────────────────
node_id        TEXT  PRIMARY KEY
view_id        TEXT  FK → views
parent_node_id TEXT  (nullable)   FK → view_nodes; NULL for root nodes
property_id    TEXT  FK → properties
fork_value     TEXT  (nullable)   Activates only when parent value matches
sort_order     INTEGER            Position among siblings
```

#### Forking Hierarchies

At any layer in the view, the hierarchy can split into independent branches based on the value of the current layer. Each branch then defines its own sequence of properties below it. This allows fundamentally different file types to share a common upper structure while diverging into type-appropriate properties lower down.

Example — a media library that splits by file type:

```
Library: Media
  └── Year
        └── [any value]
              └── Type                    ← fork point
                    ├── "Photos" branch → Rig → Component → Angle
                    └── "Videos" branch → Project → Scene → Take
```

In this configuration, navigating into a Photos folder presents Rig sub-folders; navigating into a Videos folder presents Project sub-folders. Both branches live in the same view, the same database, and the same library. The fork is a structural declaration in the view tree, not a separation of data.

With [scoped properties](#tags-properties-and-scoped-properties), most forks need no declaration: if *Rig* applies when Type is Photos and *Project* when Type is Videos, each branch only offers the properties that apply to it. Explicit `fork_value` nodes remain for a view that wants a different structure from the registry's.

#### Completeness and Empty Properties

Because a view's layer tree defines which properties are expected at each branch, the system can determine whether any given file is fully classified within that view. A file is considered **incomplete** in a view if it possesses the properties required to reach some intermediate node but is missing the properties needed to reach the leaf of its branch.

This completeness model is view-relative — the same file may be complete in a shallow view and incomplete in a deeper one. There is no global notion of a complete file independent of a view.

Scoped properties sharpen this: a level whose property doesn't apply to a file is not missing for that file. Only the **expected** state (the condition holds, no value yet) counts as incomplete.

---

## Virtual Folder Layer

### Concept

The virtual folder layer is a configurable navigation interface built entirely from database queries. It presents as a familiar folder tree to the user, but no real folders exist — each "folder" is a filtered, grouped view of the database.

Because all files share a single table, views can span multiple libraries freely. A view scoped to photos only is simply a query filtered by `library = 'photos'`. A view spanning photos and documents tagged with the same project is an equally simple query with no additional complexity.

### Layers

A virtual folder view is constructed by stacking **layers**. Each layer corresponds to a database property and acts as a grouping/filtering dimension.

- **Layer 1**: Groups all files by the chosen property. The result is a set of top-level folders, one per unique value of that property
- **Layer 2**: Within each Layer 1 folder, further groups by a second property. The result is a set of sub-folders
- **Layer N**: Additional layers continue to narrow and group the view
- **Leaf level**: Files appear only at the deepest layer of the configured tree

Both core columns (`file_type`, `library`, `timestamp`) and metadata JSON properties (`rig`, `project`, `author`, etc.) can be used as layer dimensions interchangeably. The property registry determines which properties are offered when configuring a new layer.

Example layer configuration:

| Layer | Property | Result |
|-------|----------|--------|
| 1 | Year | Folders: 2022, 2023, 2024 |
| 2 | Month | Sub-folders: January, February, … |
| 3 | Rig | Sub-sub-folders: Rig-A, Rig-B |
| Leaf | — | Individual files |

### Views

A **view** is a saved configuration of layers. Users can define and name multiple views and switch between them freely.

- Views are non-destructive — switching views never moves or modifies files
- Views can be exported as configuration files and shared with others
- Multiple views can be open simultaneously (e.g. as tabs)
- Views may be scoped to a single library or span multiple libraries

---

## Key UI Features

### Navigation

- The virtual folder tree is navigated identically to a standard OS folder structure
- Clicking into a folder filters the visible content to match that folder's database query
- Breadcrumb navigation reflects the current path through the layer hierarchy

#### Navigation versus configuration

The app has three distinct activities, and each has its own surface:

| Activity | Question it answers | Surface |
|----------|--------------------|---------|
| **Setting up a location** | "Which files on disk does Folderbase know about, and what does their existing folder structure already tell us?" | Location setup (see [Setting Up a Location](#setting-up-a-location)), a dedicated, occasional task per drive or folder |
| **Configuring a view** | "Which properties make up the levels of this folder tree?" | The view editors (local panel and master editor) |
| **Navigating a view** | "Show me my files organised this way." | Tiles, List, Columns and Database modes |

Tiles, List and Columns are the base navigation of a configured view. They never expose layer or property configuration directly. Editing in them is still meaningful, because in a virtual tree a folder path *is* a set of property values:

- Each level of the tree represents a property; the folder name at that level is a value of it
- Creating a folder at some level adds a value to that level's property
- Putting a file into a folder assigns the file every property value along the path. Dropping a file into `2024 → Rig-A → Front` sets `year = 2024`, `rig = Rig-A` and `angle = Front`

The user therefore classifies files simply by filing them, without seeing the properties underneath.

### The "+" Folder

At every level of the virtual folder tree, a persistent **"+" folder** appears as the last item in any folder listing. Clicking it creates a new named folder at that level:

- If the current layer already has a property assigned, the new folder name is added as a new value for that property in the registry
- If no property is yet assigned at this layer, the user is prompted to name the property first, then the folder name becomes its first value

The "+" folder is the primary in-context tool for extending the property vocabulary and building out the folder hierarchy without leaving the navigation interface.

### Toggling to Database View

At any level of the folder tree, the user can toggle from the folder view to a **database view**. This switches the presentation from a folder listing to a tabular, filterable list of files.

The database view does not default to filtering by the exact current path — since every file shown would share identical values for the path properties, those columns would be uninformative. Instead, it opens scoped to the current library (or the current view's scope), with the path context available as a pre-applied filter the user can relax or extend as needed.

Within the database view, the user can:

- Sort and filter by any registered property
- Edit property values inline, with dropdown pickers constrained to registered values; each dropdown includes an inline "Add value" option that writes directly to the property registry
- Assign a file to multiple virtual locations simultaneously — something the drag-and-drop folder tree cannot express for array-type properties
- View and fill empty properties for any file

The database view and the folder tree are two presentations of the same underlying query. Switching between them at any point does not change the current navigation context.

#### Preset Views Within the Database View

- **Library view**: all files in the current library, no path filters applied, all registered properties shown as columns. The starting point for bulk editing or auditing
- **Incomplete files view**: files that are missing one or more properties required to reach the leaf layer of their branch in the current view. This is the primary tool for identifying and completing partially classified files

### Importing an Existing Folder Structure

On first use, a user points the application at an existing folder on their machine. The app:

- Crawls the directory recursively
- Populates a record in the single database for every file found, extracting standard metadata automatically (timestamps, EXIF, file type, etc.)
- Assigns a `library` label based on user input or inferred from file types
- Bootstraps the property registry from metadata keys found across the ingested records
- Presents the library immediately through the virtual layer

The physical folder structure is preserved untouched. The user is not required to restructure anything before use.

### Setting Up a Location

Setup is the ingestion side of the app: bringing a new drive or folder into Folderbase, and treating its existing folder structure as an initial source of metadata. It is a dedicated function, used once per location and revisited rarely, and it lives on its own surface. It is not a control in everyday navigation or in the database view.

**Terminology.** Two verbs are kept apart. A location is **added** (and **removed**): that sets which files Folderbase knows about. A folder is **mapped** (and **unmapped**) to a property value: that says what the folder means. "Map" is used only in the second sense (Map Structure, Map Tag, "Mapped to Client"). "Mount" is not used, because it means attaching a volume to the OS, and a location whose drive is unplugged is described as *offline* or *not connected*.

The flow:

1. **Add the location**: choose a folder on disk; it is crawled and indexed (see above)
2. **Map the structure**: the location's real folder tree is shown, and the user names what folders represent. Naming a folder level `client`, for example, means each folder at that level (`Acme`, `Globex`) becomes a value of `client` for every file beneath it. Names apply only to the folders the user named; sibling folders added later are not inherited automatically
3. **Refresh** to bring the location in line with the disk. Refresh is a full sync:
   - **New files** are added, and the folder mapping is applied to them
   - **Edited files** (size or modified time changed) have their file details and EXIF re-read; the user's own values are kept
   - **Moved and renamed files** keep their record, and so their custom metadata. They are recognised by a content fingerprint (size plus the first and last 64 KB) stored with each record. Records made before fingerprints existed match on size and modified time. Identical copies are paired by file name, or left as an addition and a removal when that is still ambiguous
   - **Deleted files** have their records removed
   - Unchanged files cost a single `stat`; only new and edited files are read
   - **Safeguards**: refresh refuses to run when the location's folder is missing or suddenly empty (an unmounted drive or stuck cloud mount looks like that), and never removes records under a subfolder it could not read
   - Mapped values are only filled in where a file has none, so a file moved to a differently mapped folder keeps its existing value

After mapping, the location's files carry property values derived from their paths, and views can be built over those properties like any others. Folder names that are not mapped are kept as unstructured **tags**.

### Rules

A **rule** says "when these conditions hold, set these values". It is how values are derived from what files already carry — most often their names — across a subset of the library, without typing them file by file. Property values stay plain stored values: there are no formula-driven properties. The formula lives in the rule, and decides only what is written and when.

```
Rule: "Ruben's statements"                                [✓ Keep running]
When  [all] of:   Name  matches  {Date:6}_{Person}.pdf
                  Tags  has      Ruben
Then set:         Person  to     Ruben                       (a fixed value)
                  Date    from   {Date} as YYMMDD             (taken from the name)
Preview: 6 match · 6 will change · 0 already set               [Apply Now]
```

#### Conditions

The **When** section is the database view's filter: any native column or property, combined with *all* or *any*, counting implied values as filters do. Text columns gain **starts with** and **ends with**, and every column gains **matches pattern** (also in the Filter panel): Name, Path, Kind, Created, a property… On a list column (Source Tags, Tags, a Multi-select) a pattern matches when any one item fits, and its slots come from that item, so `Source Tags matches {Year:4} {Client}` reads the folder `2024 Acme`. A choice beside the condition narrows it to one item: for Source Tags *any folder*, *the folder it's in*, *the top folder*, *the 2nd folder*, *the 3rd folder* (for other lists: any, first, 2nd, last item). Pick from an example offers the same choice, shows only that folder of each file, and puts it on the pattern it writes. A pattern is always typed, whatever the column (a Select's value list or a date picker can't hold one). Dates are matched as written in ISO form, so `Created matches {*}-03-{*}` is any March, and `{Year:4}-{Month:2}-{*}` captures both. A period is two conditions: Created is after 2024-12-31, Created is before 2026-01-01.

#### Taking values from names, folders and other columns: three levels, one engine

1. **Pick from an example** (the default): the editor shows a matching file's name, or a value of another chosen column (a folder from Source Tags, the Path, a property), as selectable text; a list column offers each of its items. Selecting `AB12` in `Q3_AB12_final.docx` and naming it *Code* generates the pattern `{*}_{Code}_{*}.docx`, tried at once on every matching file in the preview
2. **Pattern** (always visible, editable):
   - `{Code}` captures any text; `{Code:4}` exactly 4 characters
   - `{*}` matches any text without capturing it; `{*:2}` exactly 2 characters
   - A slot can say what it holds: `{Code:digits}` (only 0–9, as many as there are), `{Code:4 digits}`, `{Code:letters}`, `{Code:upper}` (capitals), `{Code:lower}`, `{Code:alnum}` (letters and digits). Kinds split text with no separator: `{Rig:letters}{N:digits}` reads Rig42. Picking digits in an example writes `{Test:digits}` (or `{Test:4 digits}` where it runs into other text)
   - Text anywhere: `{*}invoice{*}`; at the start: `invoice{*}`
   - Everything else is matched literally, ignoring case. A pattern without an extension is matched against the name without its extension
   - Patterns come from route and format-string matching (`/users/{id}`; Python's `parse`): they read like the names they describe
3. **Formula** (full control), Notion-style functions for what a pattern can't say, usable as an action's value: `slice(name, 3, 7)`, `left`, `right`, `before(name, "_")`, `after`, `beforeLast`, `afterLast`, `match(name, "regex")` (first group), `replace(text, "regex", "with")`, `upper`, `lower`, `trim`, `date(text, "YYMMDD")`; for dates `year`, `month`, `day`, `quarter`, `formatDate(created, "MMM YYYY")`; `folder(1)` (the top folder) and `folder(-1)` (the one the file is in); `prop("Client")` for any column by its header's name (a property, or Created, Kind, Source Tags…); joined with `&`. Pattern slots can be used inside formulas: `upper({Code})`. Names available: `name` (without extension), `filename`, `ext`, `path`, `folder`, `created`, `modified`, `kind`, `size`

A file that meets the conditions but doesn't fit the pattern is shown as **no match** in the preview, and nothing is written to it.

#### Actions

**Then set** is a list, so one rule can set several properties. Besides a fixed value, a pattern slot and a formula, a value can come **from property**: another column's value, or part of it. For a list: all of it, the first, 2nd, 3rd or last item (for Source Tags: the folder it's in, the top folder, the 2nd folder…, every folder). For a date: the date, year, month, month's name, year and month, quarter or weekday. So "Year from Created's year", "Client from the folder it's in", "Tags from every folder". The property menu ends with **New Property…**, which makes one in place: named after the slot it takes ({Date} → Date) and typed by how its value is read (a date format → Date, a number → Number, a typed-in value → Select, otherwise Text), both changeable before Create. Each action writes a fixed value, a pattern slot (optionally read as a date with a format such as `YYMMDD`, or as a number), or a formula's result.

- **Fill only empty values** (the default): a Select, Text, Number or Date property is written only where it's empty; a Multi-select gains the value if it doesn't have it. **Overwrite existing values** is an option per action
- **Hand edits win**: each value a rule writes is recorded (rule, file, property, value). Once a rule has written a file's value, it never writes that value again, so changing or clearing it by hand sticks. Re-applying over hand edits is an explicit choice in the editor
- Actions on properties that no longer exist are skipped and flagged

#### When rules run

| Moment | What happens |
|--------|--------------|
| **Apply Now** in the editor | This rule runs over the matching files after the preview; undoable as one step |
| A rule is on (**Keep running**) | It runs whenever the location's files load or change: after a refresh brings in new or edited files, and after any edit that might make a file match (three conditions of four, then the fourth is set) |

Because rules only fill empty values and never rewrite their own, re-checking always settles. Rules are an ordered list: when two fill the same empty property, the earlier wins. Automatic runs aren't part of undo history; Apply Now is.

Rules are evaluated by the app (`src/lib/rules.ts`) rather than the database, so a rule's conditions match exactly what the Filter panel shows, including implied values. They run for the **open location** whenever its files load, in any view mode; another location of the same library is brought up to date when it's opened.

New rules start with Keep running off, so nothing is written until Apply Now or the rule is switched on. The rules list has an on/off tick per rule. Switching to another rule, or closing the panel, saves the one being edited. Delete Rule leaves the values a rule wrote on the files.

#### Where rules live

- Rules belong to a library and are stored in the database (`rules`, `rule_writes`), so they travel with it
- **Rules…** in the database view toolbar opens the **Rules panel**: the list on the left (name, on/off, how many files match now, drag ≡ to reorder) and the selected rule's editor on the right. Selecting a rule shows only its matching files in the table, until the panel closes. The panel sits beside the table rather than over it: the table keeps to the space on its left, so every column can be scrolled into view, and the panel's left edge drags to resize it (the width is remembered)
- **Pattern Help** (the panel's header) opens a reference beside the editor: pattern syntax and kinds, common patterns (text anywhere, starts with, a test number then a date…), how a picked value is read (date forms), every formula name and function with examples, and **Try a pattern**: a text and a pattern, showing whether it fits and what each slot picks out
- The rules list is resizable (drag its right edge; remembered). Pick from an example offers every distinct value from the files meeting the other conditions, sorted, with a **Find an example…** box to narrow them, and says how many values from how many files
- The **preview** is a table: File · Read from (the text each pattern fitted, such as the folder `0014-250701`, or what was there when none did; columns values are copied from) · Picked out (each slot's value) · Result. Buttons above it narrow it to All, Will change, No match, Already set or Changed by hand. It shows 100 rows and adds 100 more each time it's scrolled to the bottom; its columns resize by dragging their headers' edges (double-click resets; remembered), and it scrolls sideways when they don't fit
- **Make Rule from Filter…** in the Filter panel opens the Rules panel with a new rule preloaded with the current context: every filter rule and its *all/any*, and the search text as "Name contains …" (in folder views, the folder path as conditions). The loaded conditions can be changed like any other
- Renaming a property renames it in every rule; folder mapping is conceptually a built-in rule and may later be expressed as one

### Contextual File Upload

When a user drops files into a folder within the virtual tree, the system:

- Copies the file into the root directory
- Creates a new database record for the file
- Automatically assigns metadata based on the folder path context

This means the act of navigating to a location and dropping a file there is equivalent to manually filling in the corresponding metadata fields. The folder path pre-populates the metadata.

At the point of drop, the UI may also present any additional properties required to reach the leaf of the current view branch that are not already resolved by the path — allowing the user to fill in remaining fields without leaving the context.

Example — navigating to `2024 → Rig-A → Component-B → Front` and dropping a file automatically assigns:

```json
{
  "year": 2024,
  "rig": "Rig-A",
  "component": "Component-B",
  "angle": "Front"
}
```

### Virtual Folder Creation

- Creating a folder at an existing layer adds a new value to that layer's property (e.g. adding `Rig-C` to the `rig` property)
- Creating a folder at a level with no assigned property prompts the user to name the property dimension, then adds the folder name as its first value
- Folders created this way immediately appear in the virtual tree and are available as contextual metadata targets for file drops

### Multi-folder Presence

- A file can appear in multiple virtual folders simultaneously, including several sibling folders of the same property: a file can belong to both `Apollo` and `Hermes` under `project`
- This is achieved by assigning array values to a property (e.g. `"project": ["Apollo", "Hermes"]`); the property must be of type Multi-select
- No duplication of files is ever required
- Multi-value assignment is available in both presentations:
  - **Database view**: the Multi-select cell adds and removes values freely, and fill and paste apply values across many files
  - **Folder views**: following the OS convention that a plain drag moves and an Option-drag (Ctrl-drag on Windows) copies, a plain drag into a sibling folder *replaces* the file's value for that property, and an Option-drag *adds* the folder's value, so the file then appears in both places. "Remove from this folder" removes only the current folder's value. On a single-value property, an Option-drag behaves as a move

### File Operations

| Operation | Behaviour |
|-----------|-----------|
| Add file | Copies to root; creates DB record; assigns context metadata |
| Move file (virtual) | Updates metadata in DB record; physical file does not move |
| Delete file | Removes from disk and DB record |
| Rename file | Updates DB record; physical filename may remain unchanged |
| Create folder | Adds property value to registry; no physical folder created |

### View Configuration GUI

Views are created and edited through a dedicated **view configuration interface**. This is a graphical tree editor — not a settings form — reflecting the fact that a view is a tree structure that may contain forks, not a simple ordered list of layers.

Interactions in the view configuration GUI:

- **Drag to reorder**: layer nodes can be dragged to change their position within a branch
- **Add a layer**: append a new layer node to any branch, selecting the property from the registry
- **Add a fork**: at any node, introduce a fork by adding multiple child branches, each keyed to a specific value of the current layer's property
- **Label branches**: fork branches are labelled by the value that activates them (e.g. `"Photos"`, `"Videos"`)
- **Delete a node**: removing a node collapses its children up or removes the branch, with a confirmation step if files would become unclassified
- **Rename a view**: update the display name of the view
- **Duplicate a view**: create a copy as a starting point for a variation

Changes in the view configuration GUI are non-destructive to file data — they only modify `view_nodes` records. No files are moved or have their metadata altered when a view is reconfigured.

---

## Storage Management Features

### Flatten Root Directory

Once the virtual layer is established as the primary navigation interface, the physical folder structure within the root becomes redundant. Users can optionally run a **flatten** operation:

- All files are moved into a single flat directory within the root
- The database is updated to reflect new paths
- The virtual layer is entirely unaffected
- The operation is not easily reversible — users are warned before proceeding

This is an optional, one-time housekeeping step with no functional benefit to the virtual layer.

### Export to Folder Structure

Users can **materialise** any virtual view as a real folder structure on disk. This is useful for sharing files with someone who does not have the application, archiving a snapshot of a particular view, or migrating files to another system.

The export operation:

- Takes a selected view (or sub-tree within a view) as input
- Creates a real folder hierarchy on disk matching that view's layer configuration
- Populates each folder with **copies** of the relevant files (originals are untouched)
- Optionally generates symlinks instead of copies, to avoid duplication

---

## Local Desktop Application

### Platform

The application is a native desktop app, targeting macOS and Windows (Linux support desirable). It requires no internet connection and no user account for core functionality.

### Tech Stack (Recommended)

- **Shell**: Tauri (Rust + WebView) or Electron — provides native OS integration (file system access, drag-and-drop, system tray)
- **Database**: SQLite via a local driver — single-file, zero-configuration, no server process
- **UI**: Web-based frontend (React or similar) rendered within the desktop shell

### Data Portability

All user data — files and database — lives on the local file system in user-accessible locations. There is no proprietary storage format. A user can:

- Back up everything by copying their root folder(s) and the single `.db` file
- Move a library to another machine by transferring those same files
- Inspect or query the database directly using any SQLite viewer

---

## Architecture Summary

```
┌─────────────────────────────────────────┐
│         Desktop Application Shell       │
│         (Tauri / Electron)              │
├─────────────────────────────────────────┤
│              User Interface             │
│    (Virtual Folder Views + DB View)     │
├─────────────────────────────────────────┤
│          Single SQLite Database         │
│   (One `files` table — all domains)     │
│   (JSON metadata column per record)     │
│   (Property registry tables)            │
│   (views + view_nodes tables)           │
├─────────────────────────────────────────┤
│            Physical Storage             │
│     (Local Root Directory — flexible    │
│      flat or nested folder structure)   │
└─────────────────────────────────────────┘
```

One database serves all file domains. Root directories may be separate per domain or shared:

```
~/Pictures/   ←─┐
~/Documents/  ←─┼── Single virtual-folders.db
~/Videos/     ←─┘
```

---

## UI Architecture

This section defines the shell structure, navigation model, view modes, and editor surfaces of the application UI. All decisions here are informed by and consistent with the data model and virtual folder concepts defined above.

### Design Principle: OS-Native Navigation with a Platform Adapter

The virtual folder navigation experience is designed to be indistinguishable from a conventional OS file explorer within any given view. Folder browsing, drag-and-drop, breadcrumbs, and view modes all follow native OS conventions. Platform-specific details — labels, default layouts, breadcrumb style, context menu verbs — are managed by a thin platform adapter loaded at startup, keeping all platform conditionals out of UI components.

| Concern | macOS Finder | Windows Explorer | Linux (Nautilus/Dolphin) |
|---------|-------------|-----------------|--------------------------|
| Sidebar label | Favourites | Quick Access | Bookmarks |
| Trash verb | Move to Trash | Delete | Move to Trash |
| Breadcrumb style | Click-through | Editable address bar | Both |
| Address bar | Non-editable | Editable | Configurable |

### Native Fidelity Standard

The application must look and feel like the host operating system's own file manager — Finder on macOS, File Explorer on Windows. A user moving between the two should notice no difference in typography, spacing, colour, iconography, or control behaviour. **The rule is: always use the OS defaults.** Where the OS provides something, the app uses it rather than recreating it; where it must be recreated, it is measured against the native file manager and matched.

| Concern | Standard | macOS implementation |
|---------|----------|----------------------|
| Fonts | The system UI font at the system's sizes and weights | SF Pro (`-apple-system`); 13pt body text, 11pt sidebar section headings, window title bold |
| Colours | The system palette, including accent and selection colours | Finder's label, secondary-label, separator, sidebar and selection colours; solid accent-blue selection with white text in lists |
| Appearance | Light and dark both supported, following the OS by default | View ▸ Appearance: Use System Setting / Light / Dark |
| File and folder icons | The OS's own icon for each file type and for folders, never a drawn substitute | Rendered by the OS (`NSWorkspace` / `NSImage`) and cached per type and size |
| Thumbnails | The OS's own thumbnails, as the file manager's icon view shows them | Quick Look (`QLThumbnailGenerator`), rendered at the tile size for the screen's scale and cached on disk; requested as tiles near the screen, a few at a time; the file's icon until ready or when there is none |
| Interface glyphs | The OS's symbol set for sidebar items, toolbar buttons, chevrons and similar | SF Symbols rendered by the OS and tinted with the current text colour |
| Menus | Native OS menus for context menus, overflow and option menus | Native `NSMenu` (via Tauri), including checkmarks and submenus |
| Window chrome | The OS's title bar and window controls, integrated as the native app does | Unified toolbar: traffic lights over the sidebar, toolbar draggable across its full width |
| Metrics | Row heights, icon sizes, spacing and insets measured from the native file manager | List rows 20pt with 16pt icons and rounded stripes inset 10pt; icon view 64pt icons in fixed-width cells with fixed spacing |
| Behaviour | Native interaction conventions | Click headers to sort, drag dividers to resize, double-click a divider to fit, right-click headers for column options, items that don't fit the toolbar move into a » menu |

Windows follows the same rule with its own defaults: Segoe UI Variable, the Fluent palette and accent colour, shell icons (`SHGetFileInfo`), Fluent icon glyphs, and File Explorer's metrics. Platform differences live in the platform adapter and the native icon command, never in individual components.

### Application Shell Structure

The app window is divided into three persistent regions: the icon rail, the contextual sidebar, and the main pane. The icon rail is always visible; the sidebar and main pane change based on the active context.

#### Icon Rail (Always Visible)

A narrow vertical strip on the left edge of the window, analogous to VS Code's activity bar. Contains:

- One icon per saved view, acting as a drive/volume entry point
- A Master View Editor entry point at the bottom of the rail
- Clicking a view icon activates that view, replacing the sidebar content with view-local navigation
- The currently active view icon is highlighted; all others remain available for single-click switching

The icon rail keeps the concept of "all views" permanently accessible without requiring a back button or nested navigation. It is never hidden.

#### Contextual Sidebar

The sidebar to the right of the icon rail changes based on context:

- When no view is active: shows a welcome/empty state with instructions to select a view from the rail or open the master editor
- When a view is active: shows the view-local sidebar (sub-view switcher, starred locations within the view, and any OS-standard items like Recents)

#### Locations

Locations (drives and folders added to Folderbase) are listed in the sidebar, as Finder lists Locations, and added with **Add Location…** below the list. Opening one shows its files as indexed. Location actions live on the location itself, not in navigation toolbars or the database view (see [Setting Up a Location](#setting-up-a-location)):

- **Refresh**: a refresh button appears when hovering a location, and stays (spinning) while the location is being indexed, including straight after it is added. Also in the location's context menu
- **Map Structure…**: in the context menu. Opens the structure panel over the location's files in any view mode, switching to the location first. Also in the database view toolbar for now, where it shows whether the location has mappings
- **Remove Location…**: in the context menu only (no hover control), confirmed in a dialog sheet. Files on disk are untouched

#### Main Pane

The primary content area. Renders the current view mode (Tiles, List, Columns, or Database) for the active folder context. Responds to navigation actions from both the sidebar and the breadcrumb toolbar.

### View-Local Navigation

Once a view is activated from the icon rail, the application behaves like a standard OS explorer scoped to that view's virtual hierarchy.

#### View Sidebar

The view sidebar contains three elements from top to bottom:

- **Sub-view switcher**: if the active view has named sub-views (e.g. "By Rig" and "By Project"), these appear as a compact switcher at the top of the sidebar. Selecting one changes the layer configuration without leaving the view
- **Starred locations**: user-bookmarked paths within this view, displayed as named shortcuts analogous to Finder favourites or Windows Explorer quick access entries. Clicking one navigates directly to that path
- **OS-standard items**: Recents, search scope indicator, and any other platform-appropriate navigation items below the starred locations

#### Toolbar

The toolbar sits above the main pane and contains:

- **Breadcrumb / address bar**: reflects the current navigation path through the virtual layer hierarchy (e.g. `2024 → Rig-A → Component-B`). Style is platform-adaptive — click-through on macOS, editable on Windows
- **View mode switcher**: Database | Tiles | List | Columns. Database is the default mode on every platform and sits first; Tiles, List, and Columns follow standard OS explorer behaviour
- **Group button**: the OS file manager's grouping and sorting menu, shown for Tiles, List and Columns
- **Selection count**: when two or more files are selected, "3 of 1,204 selected" appears beside the location name, in every view mode. Columns counts within the active column, as Finder does. The database view shows it in its own file count line instead ("1,492 files" becomes "3 of 1,492 selected"), counting files whether rows or cells across several rows are selected
- **Edit Structure toggle**: opens or closes the local view editor panel (see View Editor section)

### View Modes

#### Tiles, List, and Columns

These three modes replicate standard OS explorer behaviour exactly. Folder items, file thumbnails, selection, drag-and-drop, and context menus all behave as the user would expect from their native OS. No virtual-folder-specific chrome is introduced into these modes beyond the breadcrumb path.

All three share the native **Sort By** and **Group By** options, chosen from the toolbar's group button or by right-clicking the view's background. Grouping follows the OS file manager's buckets — on macOS, Kind (Documents, Images, PDF Documents, Movies, Music, Presentations, Spreadsheets, Developer, Other), Name, Date Modified, Date Created and Size.

#### Database View

The database view is a fourth view mode, available alongside the standard three via the toolbar switcher. It presents files at the current folder context as an editable metadata table rather than as folder/file icons.

Key characteristics:

- **Scope**: opens scoped to the current library (not the exact current path), with the path context pre-applied as a relaxable filter. This avoids showing columns where every row has the same value
- **Columns**: one column per registered property for the current library scope, plus core columns (file name, type, timestamp)
- **Inline editing**: all metadata cells are editable inline. Each editable cell presents a dropdown picker constrained to values in the property registry for that property. The bottom of each dropdown includes an "Add value" option that immediately creates a new registry entry and selects it
- **Multi-value properties**: array-type properties display all assigned values in the cell and support adding or removing values, enabling multi-folder presence
- **Sorting and filtering**: any column can be sorted or filtered, including JSON metadata properties

#### Native and custom properties

**Terminology:** in the interface, the fields shown in the database view are always called **properties**, never columns, including in menus and buttons (Properties, Show All Properties, Hide Empty Custom Properties). "Columns" is reserved for the Columns view mode, as in Finder.

Properties are of two kinds, and they behave differently:

- **Native properties** describe the file itself: Name, Extension, Path, Kind, Size, Created, Modified, Tags, and values extracted from the file (EXIF). They are read-only in the table. Kind uses the same buckets as Group By ▸ Kind (Documents, Images, PDF Documents, Movies, Music, Presentations, Spreadsheets, Developer, Other); Extension gives the exact format
- **Custom properties** are the ones in the registry. Their cells are editable

#### Adding and managing properties

- A **"+" button** sits at the right end of the header row. Clicking it opens a native menu of types: Text, Number, Currency, Percentage, Date, Dropdown, Multi-select. Choosing one immediately adds a column of that type, registered for the current library. The new column is named after its type ("Text"; "Text 2", "Text 3"… if the name is taken), and its header name is open for editing with the text selected, so the user can type a name straight away or press Return to keep the default
- **Right-clicking a header** opens the column menu: Sort Ascending, Sort Descending, Filter by this column, and for custom columns Rename (edits the name in place in the header, as does double-clicking a custom column's header), Property Type and Delete, and for Multi-select properties and Source Tags **Wrap Values**, followed by Freeze Name and the show/hide property list. Deleting a property asks for confirmation, because it removes the property's values from every file
- **The property list** (in the header menu, the toolbar's Properties menu, and a **"…" button** to the right of the header's "+", as in Notion) starts with bulk controls: Show All Properties; Show / Hide All Native Properties (the file's own fields, Source Tags and values read from the file; Name always stays); Show / Hide All Custom Properties (every editable property); then **Hide Empty Custom Properties** (hides every shown custom property with no value in the rows currently shown) and **Show Non-Empty Custom Properties** (shows every hidden custom property that has a value in them). Native properties are never affected by these two. "Currently shown" means after search and filters. Like the Show All commands, these are one-off actions, not live modes: the table never changes its properties by itself when the filters change, and any property can still be shown or hidden afterwards. Below them come the native properties (Name, Extension, Path, Kind, Size, Created, Modified, Source Tags), then a **More Info** submenu holding the values read from the file (Camera Make, Camera Model, Date Taken, Focal Length, ISO, Width, Height, Latitude, Longitude, with Show All and Hide All), named and grouped as in Finder's Get Info, then the custom properties. The list ends with Size All Properties to Fit.

  The property list, and the header menu that contains it, is a menu-styled panel rather than a native menu, because native menus close on every click. Ticking a property toggles it in place and the panel stays open, submenus included; it closes once the pointer has left it, on a click elsewhere, or with Escape. Commands (Show All, Rename…, Size All Properties to Fit) run and close, as in a native menu

#### Selection and editing

Selection follows spreadsheet conventions:

- **Clicking a native cell** (including Name) selects the whole row, as in a Finder list. Row selection supports Shift and Cmd as usual
- **Clicking a custom cell** selects that cell only. A cell selection is drawn as an accent-colour outline around the whole selected block (rounded at its outer corners), as in Numbers, rather than filled. Cmd-click adds or removes single cells; Shift-click selects the rectangle from the anchor cell. The arrow keys move the selection
- **Drag to select**: press on a cell and drag to select the block of cells to the one under the pointer, as in a spreadsheet; the table scrolls when the pointer nears an edge, and group headings are skipped. Shift-drag extends from the selection's anchor, ⌘-drag (Ctrl-drag) adds the block to the selection. Delete then clears every selected cell as one undoable change
- **Editing**: double-click a selected cell, press Return or just start typing to edit it in place with the editor for its type. Return commits, Escape cancels, Tab commits and moves right. Delete clears the selected cells
- **Fill handle**: a selection of cells shows a small accent dot straddling its bottom-right corner. Dragging it up or down repeats the selected values into the cells it covers, as in Excel or Numbers
- **Copy and paste**: Cmd-C copies the selected cells; Cmd-V pastes. A single copied value fills every selected cell; a block of values pastes from the anchor cell downward and to the right. Pasted text is converted to each column's type, and new Dropdown or Multi-select values are added to the registry

#### Filter, Sort and Group

- **Header click** cycles that column through ascending, descending and unsorted
- Separate **Filter**, **Sort** and **Group** buttons, side by side to the left of the search field, each open a panel for detailed control:
  - **Filter**: a list of rules (column, condition, value), combined with *all* or *any*. Conditions depend on the column type: contains / is / is not / is empty / is not empty for text; = ≠ > < ≥ ≤ for numbers; is / before / after for dates; has any of / has none of for Dropdown and Multi-select, and for the native Extension and Kind columns, whose values are picked from those the files have
  - **Sort**: an ordered list of sort keys (then by…), each ascending or descending
  - **Group**: an ordered list of grouping levels (Group by… then by…), each ascending or descending, with Collapse All and Expand All. Also a header's context menu ▸ Group by *Property*, which adds or removes that level
- Sort keys and grouping levels are reordered by dragging each row's handle
- Each button shows how many rules, sort levels or grouping levels are active, so a filtered table is never mistaken for a complete one
- **Groups** show as heading rows (label and file count) with a disclosure arrow on the left; nested levels step in. Clicking a heading collapses or expands it, and Option-click does the same to every group at that level, as with Finder's disclosure triangles. Right-clicking a heading offers Collapse/Expand that group, Collapse/Expand All *Property* Groups (its level) and, with several levels, Collapse/Expand All Groups. In the Group panel each level has its own arrow, pointing down while its groups are open, right once they are all collapsed and diagonally when some are, which collapses or expands that level alone Rows are sorted by the Sort keys within each group, and striping restarts in each group. Grouping and which groups are collapsed are kept per location
- **Group keys**: Finder's own buckets for the native columns, as Group By in the other view modes (Name by first letter, Kind by category, Size by range, Created and Modified by Today / Yesterday / Previous 7 Days…); Path by containing folder; properties by value, with Date properties by month and a Multi-select by its combination of values (so each file appears once). Files without a value go in a last "No *Property*" group

#### Undo and redo

Every change made in the database view can be undone with Cmd-Z and redone with Shift-Cmd-Z (Ctrl-Z / Ctrl-Y on Windows and Linux), as in any document-based app:

- Cell edits, fills, pastes and clears. Undo restores the previous values and selects the affected cells
- Adding, renaming and deleting a property, and changing its type. Undoing a type change restores every file's original value, even where the conversion merged values (a list joined into text)
- Deleting a Dropdown or Multi-select value. Undo re-registers the value and puts it back on every file that had it

Edit ▸ Undo and Redo in the menu bar do the same, and name the change they will act on ("Undo Paste", "Redo Rename Property"), as native apps do. Changes and their reversals are applied strictly in order. While a text field has focus, Undo (menu or Cmd-Z) undoes typing in that field instead. History covers the current location's database view and is cleared when another location is opened. View settings (column visibility, order, widths, filters) are preferences, not changes, and are not part of the history.

#### Wrapping Multi-select values

Multi-select and Source Tags cells show every value, wrapping the pills onto further lines, and the row grows to fit the tallest wrapped cell; rows with nothing to wrap keep the standard 20pt height. Wrapping is on by default for each Multi-select property and for Source Tags, and can be turned off for each with Wrap Values in its header menu, which keeps the values on one line, showing the first few and a "+N" count.

#### Frozen Name column

The Name column is frozen at the left edge by default, so the file a row belongs to stays visible while scrolling across many properties. Freezing can be turned off with Freeze Name in the header menu.

#### Database View Presets

- **Library view**: all files in the current library, no path filters applied, all registered properties shown as columns. The entry point for bulk editing or auditing
- **Incomplete files view**: files that are missing one or more properties required to reach the leaf of their branch in the current view. The primary tool for identifying and filling partially classified files

Switching between the database view and any folder view mode does not change the underlying navigation context. The same breadcrumb path applies in both.

### View Editor

The view editor is the interface for arranging and restructuring the virtual folder hierarchy. The same underlying tree editor component is used in two distinct contexts: local (in-context, as a panel) and master (full-window).

#### Local View Editor (Panel)

Accessed via the Edit Structure toggle in the toolbar. Opens as a drawer or side panel alongside the main pane without obscuring it.

- **Default scope**: shows the view tree from the current navigation node downward (sub-tree view). This is the everyday interaction surface — "I'm here in the hierarchy, I want to adjust what's below me"
- **Full tree toggle**: a control within the panel switches to showing the complete view tree with the current node highlighted. Useful when restructuring requires understanding the broader context
- **Non-destructive**: changes in the local editor only modify `view_nodes` records. No file data or metadata is altered

#### Master View Editor (Full Window)

Accessed from the icon rail (dedicated entry point at the bottom). Opens as a full-window overlay or dedicated window, replacing the main pane.

- **Scope**: the complete hierarchy of all views and all branches, with no filtering by current context
- **Use cases**: creating new views, restructuring top-level branches, managing forks across the full hierarchy, renaming or duplicating views
- **Admin surface**: intended for less frequent, higher-impact structural decisions. Not the everyday editing interface

#### View Editor Interactions (Both Contexts)

- **Drag to reorder**: layer nodes can be dragged to change their position within a branch
- **Add a layer**: append a new layer node to any branch, selecting the property from the registry
- **Add a fork**: at any node, split into multiple child branches each keyed to a specific property value
- **Label branches**: fork branches are labelled by the activating value
- **Delete a node**: collapses children up or removes the branch; confirmation required if files would become unclassified
- **Rename / duplicate view**: available in both contexts, primary in the master editor

### Full UI Structure Reference

```
App Window
├── Icon Rail                                   [always visible, left edge]
│   ├── 📁 Photos Library
│   ├── 📁 Documents
│   ├── 📁 Videos
│   ├── [+ Add View]
│   └── [⚙ Master View Editor]
│
├── Contextual Sidebar
│   ├── Sub-view switcher               [top of sidebar, if sub-views exist]
│   ├── Starred locations within view
│   ├── OS-standard items (Recents, etc.)
│   └── Locations                       [added drives/folders; Map Structure, Refresh, Remove via context menu]
│
├── Toolbar
│   ├── Breadcrumb / address bar        [platform-adaptive]
│   ├── View mode switcher              [Database | Tiles | List | Columns]
│   └── [Edit Structure toggle]         [opens local view editor panel]
│
└── Main Pane
    ├── Tiles / List / Columns          [standard OS explorer modes]
    └── Database view                   [editable metadata table]

[Local View Editor — panel/drawer, toggled from toolbar]
    └── Tree editor, default: sub-tree from current node
         Toggle to: full tree with current position highlighted

[Master View Editor — full-window overlay, from icon rail]
    └── Tree editor for all views, full hierarchy
```

---

## Future Considerations

- **AI-assisted tagging**: Automatic metadata extraction from file content (e.g. face recognition, object detection for photos, document text extraction)
- **Search**: Full-text and property-based search across the single database
- **Permissions**: Per-view or per-property access controls for shared machines or team use cases
- **Cloud sync**: Optional integration with cloud storage providers (Dropbox, S3, etc.) as the physical storage layer, with the local database remaining the source of virtual organisation
- **JSON index promotion**: UI tooling to identify heavily-queried metadata properties and add SQLite JSON path indexes automatically
- **Registry health tools**: Tooling to detect orphaned property values, inconsistently cased keys, and other data hygiene issues
- **Conditional property values**: Whether valid values for a property should be constrained by the parent context. Requires UX design to determine how unrecognised or cross-context values are surfaced. To be designed.
- **Cross-branch value visibility**: When a value exists in the registry but has no files under the current branch, how should the folder tree present it? Options include hiding entirely, greying with a disclosure toggle, or an "uncategorised" group. To be designed.
