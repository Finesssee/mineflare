To view the pictures and diagrams please visithttps://developers.openai.com/apps-sdk/concepts/design-guidelines in @Browser.

App design guidelines
Design guidelines for developers building on the Apps SDK.

Overview
Apps are developer-built experiences that live inside ChatGPT. They extend what users can do without breaking the flow of conversation, appearing through lightweight cards, carousels, fullscreen views, and other display modes that integrate seamlessly into ChatGPT’s interface while maintaining its clarity, trust, and voice.

Example apps in the ChatGPT mobile interface

These guidelines will give you everything you need to begin building high-quality, consistent, and user-friendly experiences inside ChatGPT.

Best practices
Apps are most valuable when they help people accomplish meaningful tasks directly within ChatGPT, without breaking the conversational flow. The goal is to design experiences that feel consistent, useful, and trustworthy while extending ChatGPT in ways that add real value. Good use cases include booking a ride, ordering food, checking availability, or tracking a delivery. These are tasks that are conversational, time bound, and easy to summarize visually with a clear call to action.

Poor use cases include pasting in long form content from a website, requiring complex multi step workflows, or using the space for ads or irrelevant messaging.

Principles
Conversational: Experiences should feel like a natural extension of ChatGPT, fitting seamlessly into the conversational flow and UI.
Intelligent: Tools should be aware of conversation context, supporting and anticipating user intent. Responses and UI should feel individually relevant.
Simple: Each interaction should focus on a single clear action or outcome. Information and UI should be reduced to the absolute minimum to support the context.
Responsive: Tools should feel fast and lightweight, enhancing conversation rather than overwhelming it.
Accessible: Designs must support a wide range of users, including those who rely on assistive technologies.
Boundaries
ChatGPT controls system-level elements such as voice, chrome, styles, navigation, and composer. Developers provide value by customizing content, brand presence, and actions inside the system framework.

This balance ensures that all apps feel native to ChatGPT while still expressing unique brand value.

Good use cases
A good app should answer “yes” to most of these questions:

Does this task fit naturally into a conversation? (for example, booking, ordering, scheduling, quick lookups)
Is it time-bound or action-oriented? (short or medium duration tasks with a clear start and end)
Is the information valuable in the moment? (users can act on it right away or get a concise preview before diving deeper)
Can it be summarized visually and simply? (one card, a few key details, a clear CTA)
Does it extend ChatGPT in a way that feels additive or differentiated?
Poor use cases
Avoid designing tools that:

Display long-form or static content better suited for a website or app.
Require complex multi-step workflows that exceed the inline or fullscreen display modes.
Use the space for ads, upsells, or irrelevant messaging.
Surface sensitive or private information directly in a card where others might see it.
Duplicate ChatGPT’s system functions (for example, recreating the input composer).
By following these best practices, your tool will feel like a natural extension of ChatGPT rather than a bolt-on experience.

Display modes
Display modes are the surfaces developers use to create experiences inside ChatGPT. They allow partners to show content and actions that feel native to conversation. Each mode is designed for a specific type of interaction, from quick confirmations to immersive workflows.

Using these consistently helps experiences stay simple and predictable.

Inline
The inline display mode appears directly in the flow of the conversation. Inline surfaces currently always appear before the generated model response. Every app initially appears inline.

Examples of inline cards and carousels in ChatGPT

Layout

Icon & tool call: A label with the app name and icon.
Inline display: A lightweight display with app content embedded above the model response.
Follow-up: A short, model-generated response shown after the widget to suggest edits, next steps, or related actions. Avoid content that is redundant with the card.
Inline card
Lightweight, single-purpose widgets embedded directly in conversation. They provide quick confirmations, simple actions, or visual aids.

Examples of inline cards

When to use

A single action or decision (for example, confirm a booking).
Small amounts of structured data (for example, a map, order summary, or quick status).
A fully self-contained widget or tool (e.g., an audio player or a score card).
Layout

Diagram of inline cards

Title: Include a title if your card is document-based or contains items with a parent element, like songs in a playlist.
Expand: Use to open a fullscreen display mode if the card contains rich media or interactivity like a map or an interactive diagram.
Show more: Use to disclose additional items if multiple results are presented in a list.
Edit controls: Provide inline support for ChatGPT responses without overwhelming the conversation.
Primary actions: Limit to two actions, placed at bottom of card. Actions should perform either a conversation turn or a tool call.
Interaction

Diagram of interaction patterns for inline cards

Cards support simple direct interaction.

States: Edits made are persisted.
Simple direct edits: If appropriate, inline editable text allows users to make quick edits without needing to prompt the model.
Dynamic layout: Card layout can expand its height to match its contents up to the height of the mobile viewport.
Rules of thumb

Limit primary actions per card: Support up to two actions maximum, with one primary CTA and one optional secondary CTA.
No deep navigation or multiple views within a card. Cards should not contain multiple drill-ins, tabs, or deeper navigation. Consider splitting these into separate cards or tool actions.
No nested scrolling. Cards should auto-fit their content and prevent internal scrolling.
No duplicative inputs. Don’t replicate ChatGPT features in a card.
Examples of patterns to avoid in inline cards

Inline carousel
A set of cards presented side-by-side, letting users quickly scan and choose from multiple options.

Example of inline carousel

When to use

Presenting a small list of similar items (for example, restaurants, playlists, events).
Items have more visual content and metadata than will fit in simple rows.
Layout

Diagram of inline carousel

Image: Items should always include an image or visual.
Title: Carousel items should typically include a title to explain the content.
Metadata: Use metadata to show the most important and relevant information about the item in the context of the response. Avoid showing more than two lines of text.
Badge: Use the badge to show supporting context where appropriate.
Actions: Provide a single clear CTA per item whenever possible.
Rules of thumb

Keep to 3–8 items per carousel for scannability.
Reduce metadata to the most relevant details, with three lines max.
Each card may have a single, optional CTA (for example, “Book” or “Play”).
Use consistent visual hierarchy across cards.
Fullscreen
Immersive experiences that expand beyond the inline card, giving users space for multi-step workflows or deeper exploration. The ChatGPT composer remains overlaid, allowing users to continue “talking to the app” through natural conversation in the context of the fullscreen view.

Example of fullscreen

When to use

Rich tasks that cannot be reduced to a single card (for example, an explorable map with pins, a rich editing canvas, or an interactive diagram).
Browsing detailed content (for example, real estate listings, menus).
Layout

Diagram of fullscreen

System close: Closes the sheet or view.
Fullscreen view: Content area.
Composer: ChatGPT’s native composer, allowing the user to follow up in the context of the fullscreen view.
Interaction

Interaction patterns for fullscreen

Chat sheet: Maintain conversational context alongside the fullscreen surface.
Thinking: The composer input “shimmers” to show that a response is streaming.
Response: When the model completes its response, an ephemeral, truncated snippet displays above the composer. Tapping it opens the chat sheet.
Rules of thumb

Design your UX to work with the system composer. The composer is always present in fullscreen, so make sure your experience supports conversational prompts that can trigger tool calls and feel natural for users.
Use fullscreen to deepen engagement, not to replicate your native app wholesale.
Picture-in-picture (PiP)
A persistent floating window inside ChatGPT optimized for ongoing or live sessions like games or videos. PiP remains visible while the conversation continues, and it can update dynamically in response to user prompts.

Example of picture-in-picture

When to use

Activities that run in parallel with conversation, such as a game, live collaboration, quiz, or learning session.
Situations where the PiP widget can react to chat input, for example continuing a game round or refreshing live data based on a user request.
Interaction

Interaction patterns for picture-in-picture

Activated: On scroll, the PiP window stays fixed to the top of the viewport
Pinned: The PiP remains fixed until the user dismisses it or the session ends.
Session ends: The PiP returns to an inline position and scrolls away.
Rules of thumb

Ensure the PiP state can update or respond when users interact through the system composer.
Close PiP automatically when the session ends.
Do not overload PiP with controls or static content better suited for inline or fullscreen.
Visual design guidelines
A consistent look and feel is what makes partner-built tools feel like a natural part of ChatGPT. Visual guidelines ensure partner experiences remain familiar, accessible, and trustworthy, while still leaving room for brand expression in the right places.

These principles outline how to use color, type, spacing, and imagery in ways that preserve system clarity while giving partners space to differentiate their service.

Why this matters
Visual and UX consistency protects the overall user experience of ChatGPT. By following these guidelines, partners ensure their tools feel familiar to users, maintain trust in the system, and deliver value without distraction.

Color
System-defined palettes ensure actions and responses always feel consistent with ChatGPT. Partners can add branding through accents, icons, or inline imagery, but should not redefine system colors.

Color palette

Rules of thumb

Use system colors for text, icons, and spatial elements like dividers.
Partner brand accents such as logos or icons should not override backgrounds or text colors.
Avoid custom gradients or patterns that break ChatGPT’s minimal look.
Use brand accent colors on primary buttons inside app display modes.
Example color usage

Use brand colors on accents and badges. Don’t change text colors or other core component styles.

Example color usage

Don’t apply colors to backgrounds in text areas.

Typography
ChatGPT uses platform-native system fonts (SF Pro on iOS, Roboto on Android) to ensure readability and accessibility across devices.

Typography

Rules of thumb

Always inherit the system font stack, respecting system sizing rules for headings, body text, and captions.
Use partner styling such as bold, italic, or highlights only within content areas, not for structural UI.
Limit variation in font size as much as possible, preferring body and body-small sizes.
Example typography

Don’t use custom fonts, even in full screen modes. Use system font variables wherever possible.

Spacing & layout
Consistent margins, padding, and alignment keep partner content scannable and predictable inside conversation.

Spacing & layout

Rules of thumb

Use system grid spacing for cards, collections, and inspector panels.
Keep padding consistent and avoid cramming or edge-to-edge text.
Respect system specified corner rounds when possible to keep shapes consistent.
Maintain visual hierarchy with headline, supporting text, and CTA in a clear order.
Icons & imagery
System iconography provides visual clarity, while partner logos and images help users recognize brand context.

Icons

Rules of thumb

Use either system icons or custom iconography that fits within ChatGPT’s visual world — monochromatic and outlined.
Do not include your logo as part of the response. ChatGPT will always append your logo and app name before the widget is rendered.
All imagery must follow enforced aspect ratios to avoid distortion.
Icons & imagery

Accessibility
Every partner experience should be usable by the widest possible audience. Accessibility is a requirement, not an option.

Rules of thumb

Text and background must maintain a minimum contrast ratio (WCAG AA).
Provide alt text for all images.
Support text resizing without breaking layouts.
Tone & proactivity
Tone and proactivity are critical to how partner tools show up inside ChatGPT. Partners contribute valuable content, but the overall experience must always feel like ChatGPT: clear, helpful, and trustworthy. These guidelines define how your tool should communicate and when it should resurface to users.

Tone ownership
ChatGPT sets the overall voice.
Partners provide content within that framework.
The result should feel seamless: partner content adds context and actions without breaking ChatGPT’s natural, conversational tone.
Content guidelines
Keep content concise and scannable.
Always context-driven: content should respond to what the user asked for.
Avoid spam, jargon, or promotional language.
Focus on helpfulness and clarity over brand personality.
Proactivity rules
Proactivity helps users by surfacing the right information at the right time. It should always feel relevant and never intrusive.

Allowed: contextual nudges or reminders tied to user intent.
Example: “Your order is ready for pickup” or “Your ride is arriving.”
Not allowed: unsolicited promotions, upsells, or repeated attempts to re-engage without clear context.
Example: “Check out our latest deals” or “Haven’t used us in a while? Come back.”
Transparency
Always show why and when your tool is resurfacing.
Provide enough context so users understand the purpose of the nudge.
Proactivity should feel like a natural continuation of the conversation, not an interruption.
Why this matters
The way partner tools speak and re-engage defines user trust. A consistent tone and thoughtful proactivity strategy ensure users remain in control, see clear value, and continue to trust ChatGPT as a reliable, helpful interface.

Design components
Plan and design UI components that users can interact with.

Why components matter
UI components are the human-visible half of your connector. They let users view or edit data inline, switch to fullscreen when needed, and keep context synchronized between typed prompts and UI actions. Planning them early ensures your MCP server returns the right structured data and component metadata from day one.

Clarify the user interaction
For each use case, decide what the user needs to see and manipulate:

Viewer vs. editor – is the component read-only (a chart, a dashboard) or should it support editing and writebacks (forms, kanban boards)?
Single-shot vs. multiturn – will the user accomplish the task in one invocation, or should state persist across turns as they iterate?
Inline vs. fullscreen – some tasks are comfortable in the default inline card, while others benefit from fullscreen or picture-in-picture modes. Sketch these states before you implement.
Write down the fields, affordances, and empty states you need so you can validate them with design partners and reviewers.

Map data requirements
Components should receive everything they need in the tool response. When planning:

Structured content – define the JSON payload that the component will parse.
Initial component state – use window.openai.toolOutput as the initial render data. On subsequent followups that invoke callTool, use the return value of callTool. To cache state for re-rendering, you can use window.openai.setWidgetState.
Auth context – note whether the component should display linked-account information, or whether the model must prompt the user to connect first.
Feeding this data through the MCP response is simpler than adding ad-hoc APIs later.

Design for responsive layouts
Components run inside an iframe on both desktop and mobile. Plan for:

Adaptive breakpoints – set a max width and design layouts that collapse gracefully on small screens.
Accessible color and motion – respect system dark mode (match color-scheme) and provide focus states for keyboard navigation.
Launcher transitions – if the user opens your component from the launcher or expands to fullscreen, make sure navigation elements stay visible.
Document CSS variables, font stacks, and iconography up front so they are consistent across components.

Define the state contract
Because components and the chat surface share conversation state, be explicit about what is stored where:

Component state – use the window.openai.setWidgetState API to persist state the host should remember (selected record, scroll position, staged form data).
Server state – store authoritative data in your backend or the built-in storage layer. Decide how to merge server changes back into component state after follow-up tool calls.
Model messages – think about what human-readable updates the component should send back via sendFollowupTurn so the transcript stays meaningful.
Capturing this state diagram early prevents hard-to-debug sync issues later.

Plan telemetry and debugging hooks
Inline experiences are hardest to debug without instrumentation. Decide in advance how you will:

Emit analytics events for component loads, button clicks, and validation errors.
Log tool-call IDs alongside component telemetry so you can trace issues end to end.
Provide fallbacks when the component fails to load (e.g., show the structured JSON and prompt the user to retry).
Once these plans are in place you are ready to move on to the implementation details in Build a custom UX.

Describe your tools
Tools are the contract between ChatGPT and your backend. Define a clear machine name, human-friendly title, and JSON schema so the model knows when—and how—to call each tool. This is also where you wire up per-tool metadata, including auth hints, status strings, and component configuration.

Point to a component template
In addition to returning structured data, each tool on your MCP server should also reference an HTML UI template in its descriptor. This HTML template will be rendered in an iframe by ChatGPT.

Register the template – expose a resource whose mimeType is text/html+skybridge and whose body loads your compiled JS/CSS bundle. The resource URI (for example ui://widget/kanban-board.html) becomes the canonical ID for your component.
Link the tool to the template – inside the tool descriptor, set _meta["openai/outputTemplate"] to the same URI. Optional _meta fields let you declare whether the component can initiate tool calls or display custom status copy.
Version carefully – when you ship breaking component changes, register a new resource URI and update the tool metadata in lockstep. ChatGPT caches templates aggressively, so unique URIs (or cache-busted filenames) prevent stale assets from loading.
With the template and metadata in place, ChatGPT hydrates the iframe using the structuredContent payload from each tool response.

Here is an example:

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";

// Create an MCP server
const server = new McpServer({
  name: "kanban-server",
  version: "1.0.0"
});

// Load locally built assets (produced by your component build)
const KANBAN_JS = readFileSync("web/dist/kanban.js", "utf8");
const KANBAN_CSS = (() => {
  try {
    return readFileSync("web/dist/kanban.css", "utf8");
  } catch {
    return ""; // CSS optional
  }
})();

// UI resource (no inline data assignment; host will inject data)
server.registerResource(
  "kanban-widget",
  "ui://widget/kanban-board.html",
  {},
  async () => ({
    contents: [
      {
        uri: "ui://widget/kanban-board.html",
        mimeType: "text/html+skybridge",
        text: `
<div id="kanban-root"></div>
${KANBAN_CSS ? `<style>${KANBAN_CSS}</style>` : ""}
<script type="module">${KANBAN_JS}</script>
        `.trim(),
      },
    ],
  })
);

server.registerTool(
  "kanban-board",
  {
    title: "Show Kanban Board",
    _meta: {
      "openai/outputTemplate": "ui://widget/kanban-board.html",
      "openai/toolInvocation/invoking": "Displaying the board",
      "openai/toolInvocation/invoked": "Displayed the board"
    },
    inputSchema: { tasks: z.string() }
  },
  async () => {
    return {
      content: [{ type: "text", text: "Displayed the kanban board!" }],
      structuredContent: {}
    };
  }
);
Structure the data your tool returns
Each tool result in the tool response can include three sibling fields that shape how ChatGPT and your component consume the payload:

structuredContent – structured data that is used to hydrate your component, e.g. the tracks for a playlist, the homes for a realtor app, the tasks for a kanban app. ChatGPT injects this object into your iframe as window.openai.toolOutput, so keep it scoped to the data your UI needs. The model reads these values and may narrate or summarize them.
content – Optional free-form text (Markdown or plain strings) that the model receives verbatim.
_meta – Arbitrary JSON passed only to the component. Use it for data that should not influence the model’s reasoning, like the full set of locations that backs a dropdown. _meta is never shown to the model.
Your component receives all three fields, but only structuredContent and content are visible to the model. If you are looking to control the text underneath the component, please use widgetDescription.

Continuing the Kanban example, fetch board data and return the trio of fields so the component hydrates without exposing extra context to the model:

async function loadKanbanBoard() {
  const tasks = [
    { id: "task-1", title: "Design empty states", assignee: "Ada", status: "todo" },
    { id: "task-2", title: "Wireframe admin panel", assignee: "Grace", status: "in-progress" },
    { id: "task-3", title: "QA onboarding flow", assignee: "Lin", status: "done" }
  ];

  return {
    columns: [
      { id: "todo", title: "To do", tasks: tasks.filter((task) => task.status === "todo") },
      { id: "in-progress", title: "In progress", tasks: tasks.filter((task) => task.status === "in-progress") },
      { id: "done", title: "Done", tasks: tasks.filter((task) => task.status === "done") }
    ],
    tasksById: Object.fromEntries(tasks.map((task) => [task.id, task])),
    lastSyncedAt: new Date().toISOString()
  };
}

server.registerTool(
  "kanban-board",
  {
    title: "Show Kanban Board",
    _meta: {
      "openai/outputTemplate": "ui://widget/kanban-board.html",
      "openai/toolInvocation/invoking": "Displaying the board",
      "openai/toolInvocation/invoked": "Displayed the board"
    },
    inputSchema: { tasks: z.string() }
  },
  async () => {
    const board = await loadKanbanBoard();

    return {
      structuredContent: {
        columns: board.columns.map((column) => ({
          id: column.id,
          title: column.title,
          tasks: column.tasks.slice(0, 5) // keep payload concise for the model
        }))
      },
      content: [{ type: "text", text: "Here's your latest board. Drag cards in the component to update status." }],
      _meta: {
        tasksById: board.tasksById, // full task map for the component only
        lastSyncedAt: board.lastSyncedAt
      }
    };
  }
);
Build your component
Now that you have the MCP server scaffold set up, follow the instructions on the Build a custom UX page to build your component experience.

Advanced
Allow component-initiated tool access
To allow component‑initiated tool access, you should mark tools with _meta.openai/widgetAccessible: true:

"_meta": { 
  "openai/outputTemplate": "ui://widget/kanban-board.html",
  "openai/widgetAccessible": true 
}
Define component content security policies
Widgets are required to have a strict content security policy (CSP) prior to broad distribution within ChatGPT. As part of the MCP review process, a snapshotted CSP will be inspected.

To declare a CSP, your component resource should include the openai/widget meta property with a csp subproperty.

server.registerResource(
  "html",
  "ui://widget/widget.html",
  {},
  async (req) => ({
    contents: [
      {
        uri: "ui://widget/widget.html",
        mimeType: "text/html",
        text: `
<div id="kitchen-sink-root"></div>
<link rel="stylesheet" href="https://persistent.oaistatic.com/ecosystem-built-assets/kitchen-sink-2d2b.css">
<script type="module" src="https://persistent.oaistatic.com/ecosystem-built-assets/kitchen-sink-2d2b.js"></script>
        `.trim(),
        _meta: {
          "openai/widgetCSP": {
            connect_domains: [],
            resource_domains: ["https://persistent.oaistatic.com"],
          }
        },
      },
    ],
  })
);
The CSP should define two arrays of URLs: connect_domains and resource_domains. These URLs ultimately map to the following CSP definition:

`script-src 'self' ${resources}`,
`img-src 'self' data: ${resources}`,
`font-src 'self' ${resources}`,
`connect-src 'self' ${connects}`,
Configure component subdomains
Components also support a configurable subdomain. If you have public API keys (for example Google Maps) and need to restrict access to specific origins or referrers, you can set a subdomain to render the component under.

By default, all components are rendered on https://web-sandbox.oaiusercontent.com.

"openai/widgetDomain": "https://chatgpt.com"
Since we can’t support dynamic dual-level subdomains, we convert the origin chatgpt.com to chatgpt-com so the final component domain is https://chatgpt-com.web-sandbox.oaiusercontent.com.

We can promise that these domains will be unique to each partner.

Note that we still will not permit the storage or access to browser cookies, even with dedicated subdomains.

Configuring a component domain also enables the ChatGPT punchout button in the desktop fullscreen view.

Configure status strings on tool calls
You can also provide short, localized status strings during and after invocation for better UX:

"_meta": {
  "openai/outputTemplate": "ui://widget/kanban-board.html",
  "openai/toolInvocation/invoking": "Organizing tasks…",
  "openai/toolInvocation/invoked": "Board refreshed."
}

Inspect client context hints
Operation-phase requests can include extra hints under _meta.openai/* so servers can fine-tune responses without new protocol fields. ChatGPT currently forwards:

_meta["openai/userAgent"] – string identifying the client (for example ChatGPT/1.2025.012)
_meta["openai/userLocation"] – coarse location object hinting at country, region, city, timezone, and approximate coordinates
Treat these values as advisory only; never rely on them for authorization. They are primarily useful for tailoring formatting, regional content, or analytics. When logged, store them alongside the resolved locale and sanitize before sharing outside the service perimeter. Clients may omit either field at any time.

Add component descriptions
Component descriptions will be displayed to the model when a client renders a tool’s component. It will help the model understand what is being displayed to help avoid the model from returning redundant content in its response. Developers should avoid trying to steer the model’s response in the tool payload directly because not all clients of an MCP render tool components. This metadata lets rich-UI clients steer just those experiences while remaining backward compatible elsewhere.

To use this field, set openai/widgetDescription on the resource template inside of your MCP server. Examples below:

Note: You must refresh actions on your MCP in dev mode for your description to take effect. It can only be reloaded this way.

server.registerResource("html", "ui://widget/widget.html", {}, async () => ({
  contents: [
    {
      uri: "ui://widget/widget.html",
      mimeType: "text/html",
      text: componentHtml,
      _meta: {
        "openai/widgetDescription": "Renders an interactive UI showcasing the zoo animals returned by get_zoo_animals.",
      },
    },
  ],
}));

server.registerTool(
  "get_zoo_animals",
  {
    title: "get_zoo_animals",
    description: "Lists zoo animals and facts about them",
    inputSchema: { count: z.number().int().min(1).max(20).optional() },
    annotations: {
      readOnlyHint: true,
    },
    _meta: {
      "openai/outputTemplate": "ui://widget/widget.html",
    },
  },
  async ({ count = 10 }, _extra) => {
    const animals = generateZooAnimals(count);
    return {
      content: [],
      structuredContent: { animals },
    };
  }
);
Opt into component borders
Widgets that are better suited for a “Card” layout can opt into having a border rendered by ChatGPT when appropriate.

To use this field, set "openai/widgetPrefersBorder": true on the resource template inside of your MCP server.

Build a custom UX
Build custom UI components & app page.

Overview
UI components turn structured tool results into a human-friendly UI. Apps SDK components are typically React components that run inside an iframe, talk to the host via the window.openai API, and render inline with the conversation. This guide describes how to structure your component project, bundle it, and wire it up to your MCP server.

You can also check out the examples repository on GitHub.

Understand the window.openai API
window.openai is the bridge between your frontend and ChatGPT. Use this quick reference to first understand how to wire up data, state, and layout concerns before you dive into component scaffolding.

declare global {
  interface Window {
    openai: API & OpenAiGlobals;
  }

  interface WindowEventMap {
    [SET_GLOBALS_EVENT_TYPE]: SetGlobalsEvent;
  }
}

type OpenAiGlobals<
  ToolInput extends UnknownObject = UnknownObject,
  ToolOutput extends UnknownObject = UnknownObject,
  ToolResponseMetadata extends UnknownObject = UnknownObject,
  WidgetState extends UnknownObject = UnknownObject
> = {
  theme: Theme;
  userAgent: UserAgent;
  locale: string;

  // layout
  maxHeight: number;
  displayMode: DisplayMode;
  safeArea: SafeArea;

  // state
  toolInput: ToolInput;
  toolOutput: ToolOutput | null;
  toolResponseMetadata: ToolResponseMetadata | null;
  widgetState: WidgetState | null;
};

type API<WidgetState extends UnknownObject> = {
  /** Calls a tool on your MCP. Returns the full response. */
  callTool: (name: string, args: Record<string, unknown>) => Promise<CallToolResponse>;
  
  /** Triggers a followup turn in the ChatGPT conversation */
  sendFollowUpMessage: (args: { prompt: string }) => Promise<void>;
  
  /** Opens an external link, redirects web page or mobile app */
  openExternal(payload: { href: string }): void;
  
  /** For transitioning an app from inline to fullscreen or pip */
  requestDisplayMode: (args: { mode: DisplayMode }) => Promise<{
    /**
    * The granted display mode. The host may reject the request.
    * For mobile, PiP is always coerced to fullscreen.
    */
    mode: DisplayMode;
  }>;

  setWidgetState: (state: WidgetState) => Promise<void>;
};

// Dispatched when any global changes in the host page
export const SET_GLOBALS_EVENT_TYPE = "openai:set_globals";
export class SetGlobalsEvent extends CustomEvent<{
  globals: Partial<OpenAiGlobals>;
}> {
  readonly type = SET_GLOBALS_EVENT_TYPE;
}

export type CallTool = (
  name: string,
  args: Record<string, unknown>
) => Promise<CallToolResponse>;

export type DisplayMode = "pip" | "inline" | "fullscreen";

export type Theme = "light" | "dark";

export type SafeAreaInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export type SafeArea = {
  insets: SafeAreaInsets;
};

export type DeviceType = "mobile" | "tablet" | "desktop" | "unknown";

export type UserAgent = {
  device: { type: DeviceType };
  capabilities: {
    hover: boolean;
    touch: boolean;
  };
};
useOpenAiGlobal
Many Apps SDK projects wrap window.openai access in small hooks so views remain testable. This example hook listens for host openai:set_globals events and lets React components subscribe to a single global value:

export function useOpenAiGlobal<K extends keyof OpenAiGlobals>(
  key: K
): OpenAiGlobals[K] {
  return useSyncExternalStore(
    (onChange) => {
      const handleSetGlobal = (event: SetGlobalsEvent) => {
        const value = event.detail.globals[key];
        if (value === undefined) {
          return;
        }

        onChange();
      };

      window.addEventListener(SET_GLOBALS_EVENT_TYPE, handleSetGlobal, {
        passive: true,
      });

      return () => {
        window.removeEventListener(SET_GLOBALS_EVENT_TYPE, handleSetGlobal);
      };
    },
    () => window.openai[key]
  );
}
useOpenAiGlobal is an important primitive to make your app reactive to changes in display mode, theme, and “props” via subsequent tool calls.

For example, read the tool input, output, and metadata:

export function useToolInput() {
  return useOpenAiGlobal('toolInput')
}

export function useToolOutput() {
  return useOpenAiGlobal('toolOutput')
}

export function useToolResponseMetadata() {
  return useOpenAiGlobal('toolResponseMetadata')
}
Persist component state, expose context to ChatGPT
Widget state can be used for persisting data across user sessions, and exposing data to ChatGPT. Anything you pass to setWidgetState will be shown to the model, and hydrated into window.openai.widgetState.

Note that currently everything passed to setWidgetState is shown to the model. For the best performance, it’s advisable to keep this payload small, and to not exceed more than 4k tokens.

Trigger server actions
window.openai.callTool lets the component directly make MCP tool calls. Use this for direct manipulations (refresh data, fetch nearby restaurants). Design tools to be idempotent where possible and return updated structured content that the model can reason over in subsequent turns.

Please note that your tool needs to be marked as able to be initiated by the component.

async function refreshPlaces(city: string) {
  await window.openai?.callTool("refresh_pizza_list", { city });
}
Send conversational follow-ups
Use window.openai.sendFollowupMessage to insert a message into the conversation as if the user asked it.

await window.openai?.sendFollowupMessage({
  prompt: "Draft a tasting itinerary for the pizzerias I favorited.",
});
Request alternate layouts
If the UI needs more space—like maps, tables, or embedded editors—ask the host to change the container. window.openai.requestDisplayMode negotiates inline, PiP, or fullscreen presentations.

await window.openai?.requestDisplayMode({ mode: "fullscreen" });
// Note: on mobile, PiP may be coerced to fullscreen
Use host-backed navigation
Skybridge (the sandbox runtime) mirrors the iframe’s history into ChatGPT’s UI. Use standard routing APIs—such as React Router—and the host will keep navigation controls in sync with your component.

Router setup (React Router’s BrowserRouter):

export default function PizzaListRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PizzaListApp />}>
          <Route path="place/:placeId" element={<PizzaListApp />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
Programmatic navigation:

const navigate = useNavigate();

function openDetails(placeId: string) {
  navigate(`place/${placeId}`, { replace: false });
}

function closeDetails() {
  navigate("..", { replace: true });
}
Scaffold the component project
Now that you understand the window.openai API, it’s time to scaffold your component project.

As best practice, keep the component code separate from your server logic. A common layout is:

app/
  server/            # MCP server (Python or Node)
  web/               # Component bundle source
    package.json
    tsconfig.json
    src/component.tsx
    dist/component.js   # Build output
Create the project and install dependencies (Node 18+ recommended):

cd app/web
npm init -y
npm install react@^18 react-dom@^18
npm install -D typescript esbuild
If your component requires drag-and-drop, charts, or other libraries, add them now. Keep the dependency set lean to reduce bundle size.

Author the React component
Your entry file should mount a component into a root element and read initial data from window.openai.toolOutput or persisted state.

We have provided some example apps under the examples page, for example, for a “Pizza list” app, which is a list of pizza restaurants. As you can see in the source code, the pizza list React component does the following:

Mount into the host shell. The Skybridge HTML template exposes div#pizzaz-list-root. The component mounts with createRoot(document.getElementById("pizzaz-list-root")).render(<PizzaListApp />) so the entire UI stays encapsulated inside the iframe.
Subscribe to host globals. Inside PizzaListApp, hooks such as useOpenAiGlobal("displayMode") and useOpenAiGlobal("maxHeight") read layout preferences directly from window.openai. This keeps the list responsive between inline and fullscreen layouts without custom postMessage plumbing.
Render from tool output. The component treats window.openai.toolOutput as the authoritative source of places returned by your tool. widgetState seeds any user-specific state (like favorites or filters) so the UI restores after refreshes.
Persist state and call host actions. When a user toggles a favorite, the component updates React state and immediately calls window.openai.setWidgetState with the new favorites array. Optional buttons can trigger window.openai.requestDisplayMode({ mode: "fullscreen" }) or window.openai.callTool("refresh_pizza_list", { city }) when more space or fresh data is needed.
Explore the Pizzaz component gallery
We provide a number of example components in the Apps SDK examples. Treat them as blueprints when shaping your own UI:

Pizzaz List – ranked card list with favorites and call-to-action buttons.
Screenshot of the Pizzaz list component
Pizzaz Carousel – embla-powered horizontal scroller that demonstrates media-heavy layouts.
Screenshot of the Pizzaz carousel component
Pizzaz Map – Mapbox integration with fullscreen inspector and host state sync.
Screenshot of the Pizzaz map component
Pizzaz Album – stacked gallery view built for deep dives on a single place.
Screenshot of the Pizzaz album component
Pizzaz Video – scripted player with overlays and fullscreen controls.
Each example shows how to bundle assets, wire host APIs, and structure state for real conversations. Copy the one closest to your use case and adapt the data layer for your tool responses.

React helper hooks
Using useOpenAiGlobal in a useWidgetState hook to keep host-persisted widget state aligned with your local React state:

export function useWidgetState<T extends WidgetState>(
  defaultState: T | (() => T)
): readonly [T, (state: SetStateAction<T>) => void];
export function useWidgetState<T extends WidgetState>(
  defaultState?: T | (() => T | null) | null
): readonly [T | null, (state: SetStateAction<T | null>) => void];
export function useWidgetState<T extends WidgetState>(
  defaultState?: T | (() => T | null) | null
): readonly [T | null, (state: SetStateAction<T | null>) => void] {
  const widgetStateFromWindow = useWebplusGlobal("widgetState") as T;

  const [widgetState, _setWidgetState] = useState<T | null>(() => {
    if (widgetStateFromWindow != null) {
      return widgetStateFromWindow;
    }

    return typeof defaultState === "function"
      ? defaultState()
      : defaultState ?? null;
  });

  useEffect(() => {
    _setWidgetState(widgetStateFromWindow);
  }, [widgetStateFromWindow]);

  const setWidgetState = useCallback(
    (state: SetStateAction<T | null>) => {
      _setWidgetState((prevState) => {
        const newState = typeof state === "function" ? state(prevState) : state;

        if (newState != null) {
          window.openai.setWidgetState(newState);
        }

        return newState;
      });
    },
    [window.openai.setWidgetState]
  );

  return [widgetState, setWidgetState] as const;
}
The hooks above make it easy to read the latest tool output, layout globals, or widget state directly from React components while still delegating persistence back to ChatGPT.

Bundle for the iframe
Once you are done writing your React component, you can build it into a single JavaScript module that the server can inline:

// package.json
{
  "scripts": {
    "build": "esbuild src/component.tsx --bundle --format=esm --outfile=dist/component.js"
  }
}
Run npm run build to produce dist/component.js. If esbuild complains about missing dependencies, confirm you ran npm install in the web/ directory and that your imports match installed package names (e.g., @react-dnd/html5-backend vs react-dnd-html5-backend).

Embed the component in the server response
See the Set up your server docs for how to embed the component in your MCP server response.

Component UI templates are the recommended path for production.

During development you can rebuild the component bundle whenever your React code changes and hot-reload the server.

Storage
Persisting state and data for Apps SDK.

Why storage matters
Apps SDK handles conversation state automatically, but most real-world apps also need durable storage. You might cache fetched data, keep track of user preferences, or persist artifacts created inside a component. Choosing the right storage model upfront keeps your connector fast, reliable, and compliant.

Bring your own backend
If you already run an API or need multi-user collaboration, integrate with your existing storage layer. In this model:

Authenticate the user via OAuth (see Authentication) so you can map ChatGPT identities to your internal accounts.
Use your backend’s APIs to fetch and mutate data. Keep latency low; users expect components to render in a few hundred milliseconds.
Return sufficient structured content so the model can understand the data even if the component fails to load.
When you roll your own storage, plan for:

Data residency and compliance – ensure you have agreements in place before transferring PII or regulated data.
Rate limits – protect your APIs against bursty traffic from model retries or multiple active components.
Versioning – include schema versions in stored objects so you can migrate them without breaking existing conversations.
Persisting component state
Regardless of where you store authoritative data, design a clear state contract:

Use window.openai.setWidgetState for ephemeral UI state (selected tab, collapsed sections). This state travels with the conversation and is ideal for restoring context after a follow-up prompt.
Persist durable artifacts in your backend or the managed storage layer. Include identifiers in both the structured content and the widgetState payload so you can correlate them later.
Handle merge conflicts gracefully: if another user updates the underlying data, refresh the component via a follow-up tool call and explain the change in the chat transcript.
Operational tips
Backups and monitoring – treat MCP traffic like any other API. Log tool calls with correlation IDs and monitor for error spikes.
Data retention – set clear policies for how long you keep user data and how users can revoke access.
Dogfood first – run the storage path with internal testers before launching broadly so you can validate quotas, schema evolutions, and replay scenarios.
With a storage strategy in place you can safely handle read and write scenarios without compromising user trust.