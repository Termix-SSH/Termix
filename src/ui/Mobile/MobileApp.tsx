import {Terminal} from "@/ui/Mobile/Apps/Terminal/Terminal.tsx";

export function MobileApp() {
    return (
        <div className="h-screen w-screen bg-[#18181b]">
            <Terminal hostConfig={{
                ip: "n/a",
                port: 22,
                username: "n/a",
                password: "n/a"
            }} isVisible={true}/>
        </div>
    )
}