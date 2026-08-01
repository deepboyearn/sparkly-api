import { useState, useEffect } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";
import "./Onboarding.css";

interface OnboardingProps {
  onComplete: () => void;
}

const GREETINGS = [
  "Hello",
  "नमस्ते",
  "Hola",
  "Bonjour",
  "こんにちは",
];

export function Onboarding({ onComplete }: OnboardingProps) {
  const [isElectronReady, setIsElectronReady] = useState(false);
  const [step, setStep] = useState<"greeting" | "intro">(() => {
    const hasSeen = localStorage.getItem("hasSeenGreeting");
    return hasSeen === "true" ? "intro" : "greeting";
  });
  const [greetingIndex, setGreetingIndex] = useState(0);

  // Initial delay to ensure Electron window is fully visible and stable
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsElectronReady(true);
    }, 1500); // 1.5 seconds wait
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isElectronReady && step === "greeting") {
      const timer = setInterval(() => {
        setGreetingIndex((prev) => {
          if (prev === GREETINGS.length - 1) {
            clearInterval(timer);
            setTimeout(() => {
              localStorage.setItem("hasSeenGreeting", "true");
              setStep("intro");
            }, 800);
            return prev;
          }
          return prev + 1;
        });
      }, 750);
      return () => clearInterval(timer);
    }
  }, [isElectronReady, step]);

  const containerVariants: Variants = {
    hidden: { opacity: 0, scale: 0.95 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.2,
      },
    },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 30 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 1,
        ease: [0.16, 1, 0.3, 1],
      },
    },
  };

  return (
    <div className="onboarding-overlay">
      <AnimatePresence mode="wait">
        {!isElectronReady ? (
          <motion.div
            key="pre-loader"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="onboarding-pre-loader"
          >
            {/* Keeping it simple and black like macOS boot-up */}
          </motion.div>
        ) : step === "greeting" ? (
          <motion.div
            key="greeting"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.2,  }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="greeting-step"
          >
            <motion.h1
              key={greetingIndex}
              initial={{ opacity: 0, y: 20, scale: 0.9,  }}
              animate={{ opacity: 1, y: 0, scale: 1,  }}
              exit={{ opacity: 0, y: -20, scale: 1.1,  }}
              transition={{ 
                duration: 0.5,
                ease: [0.16, 1, 0.3, 1]
              }}
              className="greeting-text"
            >
              {GREETINGS[greetingIndex]}
            </motion.h1>
          </motion.div>
        ) : (
          <motion.div
            key="intro"
            className="onboarding-container"
            initial="hidden"
            animate="visible"
            variants={containerVariants}
          >
            <motion.div variants={itemVariants} className="onboarding-badge-wrap">
              <div className="custom-badge">
                <span className="badge-dot" />
                Environment Synchronized
              </div>
            </motion.div>

            <motion.div
              variants={itemVariants}
              className="title-wrapper"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            >
              <span className="welcome-text">Welcome to</span>
              <h1 className="onboarding-title text-accent">Sparkly Api</h1>
            </motion.div>

            <motion.div variants={itemVariants} className="onboarding-action">
              <Button
                onPress={onComplete}
                className="premium-button primary enter-dashboard-btn"
              >
                Enter Dashboard
                <Icon icon="solar:round-alt-arrow-right-bold-duotone" className="text-2xl" />
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Decorative Background Elements */}
      <div className="onboarding-bg-glow-1" />
      <div className="onboarding-bg-glow-2" />
      <div className="onboarding-bg-glow-3" />
    </div>
  );
}


