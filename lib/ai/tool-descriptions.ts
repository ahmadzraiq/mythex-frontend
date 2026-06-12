/**
 * Tool Descriptions — terse 1-3 line summaries for every builder tool.
 * Keys must match the tool names in builder-tools.ts.
 */

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  // ── Read ──────────────────────────────────────────────────────────────────
  'get_page_tree':       'Read the current page structure — names, IDs, types.',
  'get_node_details':    'Get props, styles, and direct children of nodes by id.',
  'get_pages':           'List all pages with IDs, names, routes.',
  'get_theme':           'Get current theme token values (colors and fonts).',
  'get_variables':       'List all custom variables and their UUIDs.',
  'get_workflows':       'List all named workflows — names, triggers.',
  'get_data_sources':    'List all data sources — IDs, labels, formula paths.',
  'get_shared_components': 'List shared component models with their full surface (properties, variables, formulas, workflows, triggers).',
  'get_formulas':        'List project-level reusable formulas (globalFormulas).',
  'search_nodes':        'Regex search across nodes, variables, workflows, formulas, datasources, and shared components. Returns tagged results.',

  // ── Structure ─────────────────────────────────────────────────────────────
  'add_component':       'Add a component by palette label. Pre-assign nodeId (UUID) to use as parentId for children in the same batch.',
  'add_icon':            'Add an icon node.',
  'add_image':           'Add an image node.',
  'add_video':           'Add a video node. Defaults: autoPlay=true, loop=true, muted=true, controls=false.',
  'add_shared_component_instance': 'Place an existing shared component on the current page as a Box with _shared metadata.',
  'set_component_props': 'Set instance props (Path 1 override) on an existing shared-component node. Use for declared-property overrides. Also use set_style/set_animation/set_text on internal node IDs (Path 2) or on the instance wrapper (Path 3).',
  'delete_node':         'Delete a node and all its children.',
  'duplicate_node':      'Create an identical copy after the original.',
  'move_node_up':        'Move a node one position up among siblings.',
  'move_node_down':      'Move a node one position down among siblings.',
  'move_node':           'Move a node to a different parent, optionally at a specific index.',
  'wrap_in_container':   'Wrap one or more nodes in a new Box.',
  'generate_structure':  'Build a nested UI tree — defines both content structure and CSS layout foundation. Box nodes are layout tools as much as content containers. Server assigns UUIDs — read from returned tree.',

  // ── Content / bindings ────────────────────────────────────────────────────
  'set_text':            'Set text on a node.',
  'set_placeholder':     'Set placeholder text on an input or select.',
  'set_href':            'Set the URL on a Link node.',
  'set_src':             'Set source URL or JS expression on Image/Video/Iframe. Accepts a static URL or a JS expression (e.g. `context?.item?.data?.avatar`). Also objectFit, alt, poster.',
  'set_video_props':     'Set Video playback props. Supported: autoPlay, loop, muted, controls.',
  'set_icon_src':        'Set icon name (static Iconify string or JS expression). Color and size are set via set_style.',
  'set_condition':       'Set a visibility condition (JS expression). Only call when the node is explicitly annotated CONDITION(...) in the compact tree — never on a REPEAT node or any other node.',
  'set_repeat':          'Make a node repeat over a list. Can also be set inline in generate_structure via repeat/keyField fields. Only call this when the target node is annotated REPEAT(...) in the compact tree.',
  'set_disabled':        'Set disabled state. Boolean or JS expression string.',
  'set_loading_state':   'Set visibility state tag — one of loading/empty/default/custom/none.',

  // ── Styling ───────────────────────────────────────────────────────────────
  'set_background':      'Set background color, image, or gradient.',
  'set_text_color':      'Set text color. Static: token/hex. Formula: ternary string. Target the Text/Icon CHILD, not the wrapper.',
  'set_border':          'Set border color, width, and style.',
  'set_shadow':          'Set or clear box-shadow.',
  'set_opacity':         'Set opacity 0-100. Cascades to children — for background-only transparency use rgba in set_background.',
  'set_transform':       'Set transform (translate, rotate, scale, skew).',
  'set_overflow':        'Set overflow (visible|hidden|scroll|auto) and pointer-events (auto|none).',
  'set_layout':          'All non-color styles in one call (layout / spacing / sizing / typography / position). Pass `breakpoint` for responsive overrides.',
  'set_size':            'Set width/height.',
  'set_style':           'Set any combination of background, text color, border, shadow, opacity, transform, and layout in one call. Pass `breakpoint` for responsive overrides.',
  'set_responsive_override': 'Per-breakpoint override for text, condition, props, actions, animation, or map. (Visual styles use set_style/set_layout\'s own breakpoint param.)',
  'clear_responsive_override': 'Remove a responsive override field, or the entire breakpoint slice when field is omitted.',

  // ── Animation ─────────────────────────────────────────────────────────────
  'set_animation':       'Set node.props.animation. Each surface (enter, exit, hover, press, loop, drag, gesture, scrollProgress, tilt, parallax, splitText, states, ...) has its own field below.',

  // ── Forms ─────────────────────────────────────────────────────────────────
  'set_input_props':     'Configure input behavior and form tracking. Supported: name, type, autoComplete, inputMode, maxLength, secureTextEntry, readOnly, multiline.',
  'set_submit':          'Toggle submit behavior on a Button inside a Form.',
  'set_validation':      'Add validation rules to an InputField. Rule types: required, email, phone, url, minLength, maxLength, pattern, formula, equalsField. Trigger: submit (default) or change.',

  // ── Workflows ─────────────────────────────────────────────────────────────
  'bind_action':         'Bind an existing workflow to a node so it fires on a user-interaction trigger. Same trigger merges steps; optional trigger overrides default.',
  'unbind_action':       'Remove a specific workflow binding from a node.',
  'create_workflow':     'Create a named workflow. Add steps via add_workflow_step in the same response.',
  'add_workflow_step':   'Add ONE step to a workflow. Call multiple times in one response to build a full step tree. Step result available at context.workflow[stepId].result.',
  'delete_workflow':     'Delete a named workflow.',
  'update_workflow_steps': 'Replace a workflow\'s steps[]. Validates formulas and JS bodies.',
  'set_workflow_params': 'Declare typed input parameters on a named workflow (consumed by runProjectWorkflow callers).',

  // ── Variables ─────────────────────────────────────────────────────────────
  'add_variable':        'Create a variable. Pre-assign variableId to reference it in the same batch. Types: string, number, boolean, object, array, form.',
  'update_variable':     'Update any variable field by id.',
  'update_variable_initial_value': 'Fully replace a variable\'s initialValue. For partial edits use patch_variable_item / patch_variable_fields.',
  'patch_variable_item': 'Merge partial fields into one array item without touching siblings.',
  'patch_variable_items': 'Batch patch — update multiple array items in one call.',
  'patch_variable_fields': 'Merge top-level fields into an object variable without replacing it.',
  'append_variable_item': 'Push a new item onto an array variable.',
  'remove_variable_item': 'Remove an item at a specific index from an array variable.',
  'delete_variable':     'Delete a variable. Accepts scope + componentModelId for component-scope vars.',

  // ── Datasources ───────────────────────────────────────────────────────────
  'add_data_source':     'Add a REST or GraphQL data source. Trigger "mount" for auto-fetch, "action" for manual.',
  'update_data_source_schema': 'Patch fields on an existing data source by id.',
  'delete_data_source':  'Remove a data source.',

  // ── Theme ─────────────────────────────────────────────────────────────────
  'set_theme_color':     'Update a theme token (no "theme-" prefix).',
  'set_theme_mode':      'Runtime light/dark/system toggle.',
  'apply_theme_preset':  'Apply a named theme preset (bulk token update).',
  'add_custom_color':    'Define a custom color (light + dark variants).',
  'delete_custom_color': 'Remove a custom color.',

  // ── Pages / app ───────────────────────────────────────────────────────────
  'add_page':            'Add a new page.',
  'switch_page':         'Switch canvas to a different page.',
  'rename_page':         'Rename a page.',
  'remove_page':         'Delete a page.',
  'set_page_config':     'Set page meta, on-mount workflow, access control, and query params.',
  'set_app_config':      'Set app-level config: projectAppName, engineConventions, defaultRoute, errorPageRoute, appPreviewData.',
  'set_auth_config':     'Configure auth provider endpoints, tokenStorage, and redirects.',

  // ── Formulas ──────────────────────────────────────────────────────────────
  'add_formula':         'Add a project-level reusable formula (name, params, body).',
  'update_formula':      'Update a project-level formula.',
  'update_formula_body': 'Patch a global formula\'s body by id.',
  'delete_formula':      'Delete a project-level formula.',

  // ── Folders ───────────────────────────────────────────────────────────────
  'create_folder':       'Create a folder for variables/workflows/data-sources/colors. `kind` selects the target.',
  'rename_folder':       'Rename a folder by kind + folderId.',
  'delete_folder':       'Remove a folder by kind + folderId.',

  // ── Shared components ─────────────────────────────────────────────────────
  'create_shared_component': 'Create a new shared-component model. Returns modelId.',
  'update_shared_component_metadata': 'Patch model name / folder / description / valueVariable.',
  'delete_shared_component': 'Delete a shared-component model. Errors if any page still embeds instances.',
  'update_shared_component_properties': 'Batch CRUD on model.properties[] — declared instance props.',
  'update_shared_component_variables':  'Batch CRUD on model.variables[uuid] — component-local vars.',
  'update_shared_component_formulas':   'Batch CRUD on model.formulas[uuid] — component-scope formulas.',
  'update_shared_component_triggers':   'Batch CRUD on model.triggers[] — declared custom-trigger emit events.',
  'enter_shared_component_edit': 'Enter SC edit mode. Subsequent primitive tools write to model.content.',
  'exit_shared_component_edit':  'Return to page editing.',
  'set_instance_controlled': 'Toggle _controlled on an SC instance. Requires the model to have valueVariable set.',

  // ── UI helpers ────────────────────────────────────────────────────────────
  'select_node':         'Select a node on canvas to highlight it.',
  'undo':                'Undo the last action.',
  'rename_node':         'Set display name visible in Layers panel.',

  // ── Media search ──────────────────────────────────────────────────────────
  'search_images':       'Search Unsplash/Pexels for photos. Returns [{url, alt}]. Query describes visual content (subject, mood, setting) — never element role.',
  'search_videos':       'Search Pexels for videos. Returns [{src, poster}]. Query describes the scene (subject, mood, setting).',
  'search_icons':        'Search Iconify for icons. Returns valid icon names. Use before set_icon_src to get the best matching icon name.',

  // ── Backend — tables ──────────────────────────────────────────────────────
  'create_table':              'Create a new database table with typed columns.',
  'add_table_column':          'Add a column to an existing table by tableId.',
  'import_erd':                'Bulk-create multiple tables with columns and relations in one call.',
  'read_table':                'Fetch full schema (columns + types + constraints) for a single table by ID.',

  // ── Backend — server workflows ────────────────────────────────────────────
  'create_server_workflow':    'Create a server-side workflow: FUNCTION (reusable), ENDPOINT (HTTP route), or MIDDLEWARE.',
  'add_server_workflow_step':  'Append a step to a server workflow (tablesInsert, hashPassword, sendResponse, tryCatch, etc.).',
  'update_server_workflow':    'Update name, description, httpMethod, httpPath, or params of a server workflow.',
  'publish_server_workflow':   'Publish an ENDPOINT workflow to make it live.',
  'read_workflow':             'Fetch full step tree for a single server workflow by ID. Call this before publish_server_workflow to verify all steps are correct.',
  'replace_workflow_step':     'Replace a single step (by stepId) in a server workflow graph without rebuilding the whole workflow. Use after read_workflow reveals a wrong or incomplete step.',
};
