import React from "react";
import { HomepageCanvas } from "./HomepageCanvas";

const HomepageApp: React.FC = () => {
  return (
    <div className="h-screen w-screen overflow-hidden">
      <HomepageCanvas fitOnLoad={true} />
    </div>
  );
};

export default HomepageApp;
