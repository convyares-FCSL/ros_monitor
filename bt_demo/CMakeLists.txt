cmake_minimum_required(VERSION 3.16)
project(bt_demo)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# behaviortree_cpp comes from the ROS install (source /opt/ros/<distro>/setup.bash
# so CMAKE_PREFIX_PATH points at it).
find_package(behaviortree_cpp REQUIRED)

add_executable(bt_demo main.cpp)
target_link_libraries(bt_demo behaviortree_cpp::behaviortree_cpp)
