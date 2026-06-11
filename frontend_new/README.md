# ROS 2 Graph Visualizer

A real-time 3D visualization tool for ROS 2 computation graphs built with React, Three.js, and Vite. Renders nodes, topics, services, and actions as an interactive force-directed graph with animated message particles, lifecycle state indicators, and configurable scene settings.

## Features

- **3D Force-Directed Layout** - Nodes, topics, services, and actions are positioned using a real-time force simulation
- **Message Particles** - Animated packets flow along topic edges showing live pub/sub traffic
- **Lifecycle States** - Visual emissive indicators for ROS 2 node lifecycle transitions
- **Frequency Monitoring** - Hz badges and sparklines for topic publish rates with stale detection
- **Scene Settings** - Customizable entity colors, sizes, outlines, background, and particle scale
- **Theme Presets** - Multiple built-in themes (Default, Midnight, Ember, Forest, Arctic, Neon)
- **Inspector Drawer** - Click any entity or message particle to inspect details
- **Sidebar** - Filterable list of all graph entities with hide/isolate controls
- **Dead-End Modes** - Hide, dim, or show unconnected topics
- **Simulation Mode** - Built-in ROS graph simulator for demo/development without a live ROS system

## Tech Stack

- **React 18** with TypeScript
- **Three.js** for 3D rendering (postprocessing bloom, force layout, particle system)
- **Tailwind CSS** for UI styling
- **Vite** for bundling and dev server
- **Lucide React** for icons

## Prerequisites

- Node.js 18+
- npm or pnpm

## Getting Started

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

The app opens at `http://localhost:5173`. By default it runs in **simulation mode**, generating a synthetic ROS 2 graph for demonstration.

## Connecting to a Live ROS 2 System

To visualize a real ROS 2 system, disable simulation mode via the header toggle and ensure a WebSocket bridge is running at `ws://localhost:8765` that publishes graph updates in the expected JSON format.

## Build

```bash
# Production build
npm run build

# Preview the production build
npm run preview

# Type check
npm run typecheck

# Lint
npm run lint
```

## Project Structure

```
src/
  App.tsx                  # Main application component
  types.ts                 # TypeScript type definitions
  components/              # React UI components
    Header.tsx             # Top bar with connection status and controls
    Sidebar.tsx            # Entity list with filtering
    InspectorDrawer.tsx    # Detail panel for selected entities
    ControlsOverlay.tsx    # Camera/view controls
    SettingsModal.tsx      # Scene configuration modal
    FrequencySparkline.tsx # Hz visualization component
  hooks/
    useRosGraph.ts         # WebSocket connection and graph state
    useTheme.ts            # Theme management
    useThreeScene.ts       # Three.js scene lifecycle hook
  three/
    SceneManager.ts        # Main 3D scene orchestration
    ForceLayout.ts         # Force-directed graph layout
    EdgeRenderer.ts        # Bezier arc edge rendering
    ParticleSystem.ts      # Animated message particles
    LabelSystem.ts         # Text sprite labels and Hz badges
  simulation/
    rosSimulator.ts        # Synthetic ROS graph generator
```

## License

Private
