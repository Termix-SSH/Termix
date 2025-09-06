import { Button } from "@/components/ui/button";
import {Menu} from "lucide-react";

interface MenuProps {
    onSidebarOpenClick?: () => void;
}

export function BottomNavbar({onSidebarOpenClick}: MenuProps) {
    return (
        <div className="w-full h-[80px] bg-[#18181BFF] flex flex-col justify-center">
            <Button className="w-[40px] h-[40px] ml-2" variant="outline" onClick={onSidebarOpenClick}>
                <Menu />
            </Button>
        </div>
    )
}