import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
  ],
  theme: {
    container: { center: true, padding: "1.5rem", screens: { "2xl": "1400px" } },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        plane: "hsl(var(--plane))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
          subtle: "hsl(var(--primary-subtle))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          subtle: "hsl(var(--destructive-subtle))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          subtle: "hsl(var(--success-subtle))",
        },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        panel: { DEFAULT: "hsl(var(--panel))", border: "hsl(var(--panel-border))" },

        /**
         * SLA health. The reserved status palette — never reused for anything
         * else, and always shipped alongside an icon and a label so the colour
         * is a reinforcement rather than the message.
         */
        sla: {
          ok: "hsl(var(--sla-ok))",
          "ok-bg": "hsl(var(--sla-ok-bg))",
          warn: "hsl(var(--sla-warn))",
          "warn-bg": "hsl(var(--sla-warn-bg))",
          critical: "hsl(var(--sla-critical))",
          "critical-bg": "hsl(var(--sla-critical-bg))",
          paused: "hsl(var(--sla-paused))",
          "paused-bg": "hsl(var(--sla-paused-bg))",
        },

        /** Priority: an ordinal single-hue ramp, low → urgent. */
        prio: {
          1: "hsl(var(--prio-1))",
          2: "hsl(var(--prio-2))",
          3: "hsl(var(--prio-3))",
          4: "hsl(var(--prio-4))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
        xs: ["0.75rem", { lineHeight: "1.125rem" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.875rem", { lineHeight: "1.375rem" }],
        lg: ["1rem", { lineHeight: "1.5rem" }],
        xl: ["1.125rem", { lineHeight: "1.625rem", letterSpacing: "-0.01em" }],
        "2xl": ["1.375rem", { lineHeight: "1.875rem", letterSpacing: "-0.015em" }],
        "3xl": ["1.875rem", { lineHeight: "2.25rem", letterSpacing: "-0.022em" }],
        // Stat-tile and hero figures.
        "4xl": ["2.25rem", { lineHeight: "2.375rem", letterSpacing: "-0.03em" }],
        "5xl": ["2.75rem", { lineHeight: "2.875rem", letterSpacing: "-0.032em" }],
      },
      spacing: { header: "3.5rem", sidebar: "15.5rem" },
      boxShadow: {
        xs: "0 1px 2px 0 hsl(var(--shadow-color) / 0.04)",
        sm: "0 1px 2px 0 hsl(var(--shadow-color) / 0.05), 0 1px 3px 0 hsl(var(--shadow-color) / 0.04)",
        card: "0 1px 2px 0 hsl(var(--shadow-color) / 0.04), 0 4px 12px -6px hsl(var(--shadow-color) / 0.07)",
        pop: "0 4px 12px -2px hsl(var(--shadow-color) / 0.10), 0 2px 4px -2px hsl(var(--shadow-color) / 0.06)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-up": "fade-up 0.25s ease-out both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
