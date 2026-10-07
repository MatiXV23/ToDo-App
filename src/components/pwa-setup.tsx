"use client";

import { useEffect } from "react";
import { startPwa } from "@/lib/pwa";

export function PwaSetup() {
  useEffect(startPwa, []);
  return null;
}
